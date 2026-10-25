#!/usr/bin/env node
/**
 * Stage 6 — Remotion 渲染 MP4（1920×1080@30fps, h264）。
 * 輸入：data/issues/<week>/storyboard.json
 * 輸出：output/weekly-<week>.mp4
 */
import { readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { loadConfig } from "./lib/config.ts";
import { errMsg } from "./lib/util.ts";

export async function runRender(opts = {}) {
  const cfg = loadConfig();
  const weekId = opts.week ?? latestWeek(cfg.dataDir);
  const weekDir = join(cfg.dataDir, "issues", weekId);
  const storyboard = JSON.parse(await readFile(join(weekDir, "storyboard.json"), "utf8"));

  const outputLocation = opts.output ?? join(cfg.outputDir, `weekly-${weekId}.mp4`);
  console.log(`[render] ${weekId}：${storyboard.totalFrames}f @ ${storyboard.fps}fps → ${outputLocation}`);

  const serveUrl = await bundle({ entryPoint: "src/index.tsx" });
  const inputProps = { storyboard };
  const composition = await selectComposition({
    serveUrl,
    id: "WeeklyRecap",
    inputProps,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 20 === 0) {
        process.stdout.write(`\r[render] ${Math.round(progress * 100)}%`);
      }
    },
  });
  process.stdout.write("\n");
  console.log(`[render] ✓ ${outputLocation}`);
  // 記錄成品資訊供 orchestrator 使用
  await writeFile(join(weekDir, "render.json"), `${JSON.stringify({ week: weekId, outputLocation }, null, 2)}\n`);
  return { outputLocation };
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
  const o = args.indexOf("--output");
  runRender({ week: i === -1 ? undefined : args[i + 1], output: o === -1 ? undefined : args[o + 1] }).catch((err) => {
    console.error("[render] 失敗：", errMsg(err));
    process.exit(1);
  });
}
