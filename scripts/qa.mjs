#!/usr/bin/env node
/**
 * Stage 7 — QA：ffprobe 規格驗證 + 從成品 MP4 抽格存證。
 * 檢查：1920×1080、30fps、h264、含音軌、30s ≤ 時長 ≤ 120s。
 * 輸出：out/qa/<week>/frame-*.png + data/issues/<week>/qa-report.json
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import { errMsg } from "./lib/util.ts";

const pexec = promisify(execFile);

export async function runQa(opts = {}) {
  const cfg = loadConfig();
  const weekId = opts.week ?? latestWeek(cfg.dataDir);
  const weekDir = join(cfg.dataDir, "issues", weekId);
  const storyboard = JSON.parse(await readFile(join(weekDir, "storyboard.json"), "utf8"));
  const video = opts.video ?? join(cfg.outputDir, `weekly-${weekId}.mp4`);

  const { stdout } = await pexec("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format", "-show_streams",
    video,
  ]);
  const probe = JSON.parse(stdout);
  const vStream = probe.streams.find((s) => s.codec_type === "video");
  const aStream = probe.streams.find((s) => s.codec_type === "audio");
  const durationSec = Number.parseFloat(probe.format?.duration ?? "0");
  const fps = vStream ? parseFps(vStream.avg_frame_rate) : 0;

  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  add("video-exists", Boolean(vStream), vStream ? `${vStream.codec_name} ${vStream.width}x${vStream.height}` : "無視訊軌");
  add("resolution", vStream?.width === 1920 && vStream?.height === 1080, `${vStream?.width}x${vStream?.height}`);
  add("codec-h264", vStream?.codec_name === "h264", String(vStream?.codec_name));
  add("fps-30", Math.abs(fps - 30) < 0.5, `${fps.toFixed(2)}fps`);
  add("has-audio", Boolean(aStream), aStream ? `${aStream.codec_name}` : "無音軌");
  add("duration-min", durationSec >= 30, `${durationSec.toFixed(1)}s`);
  add("duration-max", durationSec <= 120, `${durationSec.toFixed(1)}s`);
  const expectFrames = storyboard.totalFrames;
  add(
    "duration-matches-storyboard",
    Math.abs(durationSec - expectFrames / storyboard.fps) < 1.0,
    `mp4 ${durationSec.toFixed(1)}s vs storyboard ${(expectFrames / storyboard.fps).toFixed(1)}s`,
  );

  // 每段抽 2 格（20% / 70%）存證
  const qaDir = join("out", "qa", weekId);
  await mkdir(qaDir, { recursive: true });
  const frames = [];
  for (const [si, seg] of storyboard.segments.entries()) {
    for (const pct of [0.2, 0.7]) {
      const frame = Math.min(
        storyboard.totalFrames - 1,
        seg.from + Math.floor(seg.duration * pct),
      );
      const atSec = frame / storyboard.fps;
      const png = join(qaDir, `frame-${String(si).padStart(2, "0")}-${String(frame).padStart(4, "0")}.png`);
      try {
        await pexec("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(atSec), "-i", video, "-frames:v", "1", png]);
        frames.push(png);
      } catch (err) {
        add(`extract-frame-${frame}`, false, errMsg(err));
      }
    }
  }

  const failed = checks.filter((c) => !c.pass);
  const report = { week: weekId, video, durationSec, fps, checks, failedCount: failed.length, qaFrames: frames };
  await writeFile(join(weekDir, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  for (const c of checks) {
    console.log(`${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  console.log(`[qa] 抽格 ${frames.length} 張 → ${qaDir}`);
  if (failed.length) {
    console.error(`[qa] ${failed.length} 項檢查未通過`);
    throw new Error(`QA 未通過：${failed.map((f) => f.name).join(", ")}`);
  }
  console.log(`[qa] ✓ 全部通過`);
  return { report };
}

function parseFps(rate) {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return 0;
  return n / d;
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
  const v = args.indexOf("--video");
  runQa({ week: i === -1 ? undefined : args[i + 1], video: v === -1 ? undefined : args[v + 1] }).catch((err) => {
    console.error("[qa] 失敗：", errMsg(err));
    process.exit(1);
  });
}
