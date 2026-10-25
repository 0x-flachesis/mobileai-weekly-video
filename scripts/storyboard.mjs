#!/usr/bin/env node
/**
 * Stage 4+5 — 組裝 storyboard.json：
 *   段落時長 = 語音時長 + 緩衝 → 吸附到 BGM 節拍（誤差 ≤ 半拍）
 *   字幕 cue、KenBurns 運鏡、SFX 釘選表、總長度檢查。
 * 輸入：copy.json + audio.json（同週目錄）
 * 輸出：data/issues/<week>/storyboard.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import {
  FPS,
  HEIGHT,
  WIDTH,
  buildCaptions,
  kenburnsFor,
  makeBeatGrid,
  snapToBeat,
} from "./lib/storyboard.ts";
import { clampNumber, errMsg, hashString } from "./lib/util.ts";

/** 段落時長（秒）：clamp(語音 + 緩衝, [min, max]) */
function segDuration(audioSec, pad, min, max) {
  return clampNumber(audioSec + pad, min, max);
}

export async function runStoryboard(opts = {}) {
  const cfg = loadConfig();
  const weekId = opts.week ?? latestWeek(cfg.dataDir);
  const weekDir = join(cfg.dataDir, "issues", weekId);
  const copy = JSON.parse(await readFile(join(weekDir, "copy.json"), "utf8"));
  const audio = JSON.parse(await readFile(join(weekDir, "audio.json"), "utf8"));
  const audioByKey = new Map(audio.items.map((it) => [it.key, it]));
  const nArticles = copy.articles.length;
  if (nArticles === 0) throw new Error("沒有文章可分鏡");

  // BGM 每週輪替（依 manifest；無 manifest 時退回內建預設）
  const bgm = pickBgm(cfg, weekId);
  const grid = makeBeatGrid(bgm.bpm, FPS);

  // 文章多時收緊每段時長，控制總長
  let artPad = 1.8, artMin = 7, artMax = 16;
  const introSec = segDuration(audioByKey.get("intro").durationSec, 1.2, 3, 6);
  const outroSec = segDuration(audioByKey.get("outro").durationSec, 1.6, 4, 7);
  let est = introSec + outroSec;
  for (const a of copy.articles) est += segDuration(audioByKey.get(`article-${copy.articles.indexOf(a)}`).durationSec, artPad, artMin, artMax);
  if (est > 95) { artPad = 1.0; artMin = 6; artMax = 12; }
  if (est > 115) { artPad = 0.6; artMin = 5; artMax = 9; }

  // 原始時長（秒）→ frame，起點逐段吸附節拍
  const seed = hashString(`${weekId}:mobileai-weekly`);
  const rawDurations = [
    { kind: "intro", sec: introSec },
    ...copy.articles.map((_, i) => ({ kind: "article", sec: segDuration(audioByKey.get(`article-${i}`).durationSec, artPad, artMin, artMax), i })),
    { kind: "outro", sec: outroSec },
  ];

  let cursor = 0;
  const starts = [];
  for (const seg of rawDurations) {
    const snapped = snapToBeat(Math.round(cursor * FPS), grid);
    starts.push(snapped);
    cursor = snapped / FPS + seg.sec;
  }
  const totalFrames = snapToBeat(Math.round(cursor * FPS), grid);

  const segments = [];
  const sfx = [];
  // 開場：標題落點 slam
  sfx.push({ name: "impact", atFrame: starts[0] + 18, volume: 0.5 });

  for (const [pos, seg] of rawDurations.entries()) {
    const from = starts[pos];
    const duration = (pos + 1 < starts.length ? starts[pos + 1] : totalFrames) - from;
    const audioItem =
      seg.kind === "intro" ? audioByKey.get("intro")
      : seg.kind === "outro" ? audioByKey.get("outro")
      : audioByKey.get(`article-${seg.i}`);
    if (seg.kind === "intro") {
      segments.push({
        kind: "intro",
        from,
        duration,
        title: "mobileai 週報",
        dateLabel: copy.dateLabel,
        week: weekId,
        articleCount: nArticles,
        audio: audioItem.audio,
        audioDurationSec: audioItem.durationSec,
      });
    } else if (seg.kind === "article") {
      const a = copy.articles[seg.i];
      const audioFrames = Math.round(audioItem.durationSec * FPS);
      segments.push({
        kind: "article",
        index: seg.i,
        from,
        duration,
        articleTitle: a.title,
        headline: a.copy.shortHeadline,
        tag: a.copy.tag,
        link: a.link,
        image: a.localImage,
        kenburns: kenburnsFor(seed + seg.i * 7919),
        audio: audioItem.audio,
        audioDurationSec: audioItem.durationSec,
        captions: buildCaptions(a.copy.narration, audioFrames),
      });
      // whoosh 音量階梯（0.40 → 0.25 交替，避免連發機關槍感）
      sfx.push({ name: "whoosh", atFrame: from, volume: seg.i % 2 === 0 ? 0.4 : 0.25 });
    } else {
      segments.push({
        kind: "outro",
        from,
        duration,
        headlines: copy.articles.map((a) => a.copy.shortHeadline),
        site: "mobileai.net",
        audio: audioItem.audio,
        audioDurationSec: audioItem.durationSec,
      });
      if (from >= 45) sfx.push({ name: "riser", atFrame: from - 45, volume: 0.2 });
      sfx.push({ name: "impact", atFrame: from, volume: 0.4 });
    }
  }

  const totalSec = totalFrames / FPS;
  if (totalSec > 120) {
    throw new Error(`總長 ${totalSec.toFixed(1)}s 超過 120s 上限（文章 ${nArticles} 篇），請減少 --max 或縮短旁白`);
  }
  // 前後留 0.5s 緩衝給淡出
  const storyboard = {
    schemaVersion: 2,
    week: weekId,
    dateISO: copy.dateLabel,
    dateLabel: copy.dateLabel,
    title: `mobileai 週報 ${weekId}`,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    totalFrames,
    bgm: { src: `bgm/${bgm.file}`, volume: 0.34, bpm: bgm.bpm, fadeOutFrames: 60 },
    segments,
    sfx,
    seed,
  };
  // dateISO 用實際日期（copy.json 沒帶，讀 articles.json 的 dateISO）
  try {
    const articles = JSON.parse(await readFile(join(weekDir, "articles.json"), "utf8"));
    storyboard.dateISO = articles.dateISO;
  } catch { /* 保留 fallback */ }

  const outFile = join(weekDir, "storyboard.json");
  await writeFile(outFile, `${JSON.stringify(storyboard, null, 2)}\n`);
  console.log(
    `[storyboard] ${weekId}：${segments.length} 段、總長 ${totalSec.toFixed(1)}s（${totalFrames}f）、BGM ${bgm.file} @ ${bgm.bpm}BPM`,
  );
  return { storyboardFile: outFile, storyboard };
}

function pickBgm(cfg, weekId) {
  try {
    const manifest = JSON.parse(readFileSync(join(cfg.publicAssetsDir, "..", "bgm", "manifest.json"), "utf8"));
    const list = manifest.filter((m) => m.bpm);
    if (list.length) {
      const weekNum = Number.parseInt(weekId.slice(-2), 10) || 0;
      return list[weekNum % list.length];
    }
  } catch { /* fallback */ }
  return { name: "bgm-uplift-110", file: "bgm-uplift-110.mp3", bpm: 110 };
}

function latestWeek(dataDir) {
  const dirs = readdirSync(join(dataDir, "issues"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-W\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!dirs.length) throw new Error("找不到任何 data/issues/<week>，請先執行 fetch-feed");
  return dirs[dirs.length - 1];
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--week");
  runStoryboard({ week: i === -1 ? undefined : args[i + 1] }).catch((err) => {
    console.error("[storyboard] 失敗：", errMsg(err));
    process.exit(1);
  });
}
