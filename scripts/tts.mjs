#!/usr/bin/env node
/**
 * Stage 3 — TTS 旁白合成（intro / 各文章 / outro）。
 * 輸入：data/issues/<week>/copy.json
 * 輸出：public/assets/<week>/audio/seg-*.mp3 + data/issues/<week>/audio.json
 */
import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import { createTTS } from "./lib/tts/factory.ts";
import { errMsg } from "./lib/util.ts";

export async function runTts(opts = {}) {
  const cfg = loadConfig();
  const weekId = opts.week ?? latestWeek(cfg.dataDir);
  const weekDir = join(cfg.dataDir, "issues", weekId);
  const copy = JSON.parse(await readFile(join(weekDir, "copy.json"), "utf8"));

  const tts = createTTS(cfg.tts);
  const audioAbsDir = join(cfg.publicAssetsDir, weekId, "audio");
  await mkdir(audioAbsDir, { recursive: true });
  console.log(`[tts] provider = ${tts.name}，段落 = ${copy.articles.length + 2}`);

  const items = [];
  const jobs = [
    { key: "intro", text: copy.intro, file: "seg-00-intro.mp3" },
    ...copy.articles.map((a, i) => ({
      key: `article-${i}`,
      text: a.copy.narration,
      file: `seg-${String(i + 1).padStart(2, "0")}.mp3`,
    })),
    { key: "outro", file: `seg-${String(copy.articles.length + 1).padStart(2, "0")}-outro.mp3`, text: copy.outro },
  ];

  for (const job of jobs) {
    const absPath = join(audioAbsDir, job.file);
    const { durationSec } = await tts.synthesize(job.text, { outfile: absPath });
    // 存相對 public/ 的路徑，Remotion staticFile() 可直接用
    const rel = join("assets", weekId, "audio", job.file).split("\\").join("/");
    items.push({ key: job.key, text: job.text, audio: rel, durationSec });
    console.log(`[tts] ${job.file} ${durationSec.toFixed(2)}s「${job.text.slice(0, 18)}…」`);
  }

  const out = { week: weekId, provider: tts.name, items };
  const outFile = join(weekDir, "audio.json");
  await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[tts] 寫入 ${outFile}`);
  return { audioFile: outFile, out };
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
  runTts({ week: i === -1 ? undefined : args[i + 1] }).catch((err) => {
    console.error("[tts] 失敗：", errMsg(err));
    process.exit(1);
  });
}
