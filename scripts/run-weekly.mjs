#!/usr/bin/env node
/**
 * 總指揮：fetch → summarize → tts → storyboard → render → qa → 更新 state。
 *
 * 常用：
 *   npm run weekly -- --mock              # 全 mock（無網路 API、無 key）
 *   npm run weekly -- --date 2026-10-19   # 指定執行日（回測）
 *   npm run weekly -- --fixture /tmp/feed.xml --mock --max 3
 *   npm run weekly -- --skip-render       # 只跑到 storyboard
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import { runFetchFeed } from "./fetch-feed.mjs";
import { runSummarize } from "./summarize.mjs";
import { runTts } from "./tts.mjs";
import { runStoryboard } from "./storyboard.mjs";
import { runRender } from "./render.mjs";
import { runQa } from "./qa.mjs";
import { errMsg } from "./lib/util.ts";

function parseArgs(argv) {
  const opts = { mock: false, force: false, skipRender: false, skipQa: false };
  const flags = { "--mock": "mock", "--force": "force", "--skip-render": "skipRender", "--skip-qa": "skipQa" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) opts[flags[a]] = true;
    else if (a === "--date") opts.date = argv[++i];
    else if (a === "--fixture") opts.fixture = argv[++i];
    else if (a === "--max") opts.max = Number.parseInt(argv[++i], 10);
    else if (a === "--week") opts.week = argv[++i];
    else { console.error(`未知參數：${a}`); process.exit(2); }
  }
  return opts;
}

async function readState(dataDir) {
  try {
    return JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
  } catch {
    return { processedGuids: [], updatedAt: null, weeks: [] };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mock) {
    process.env.LLM_PROVIDER = "mock";
    process.env.TTS_PROVIDER = "mock";
  }
  const cfg = loadConfig();
  const t0 = Date.now();

  console.log(`=== mobileai 週報 ${opts.date ? `（指定日期 ${opts.date}）` : ""} ===`);
  console.log(`providers: LLM=${cfg.llm.provider} TTS=${cfg.tts.provider}`);

  // Stage 1: fetch
  const fetched = await runFetchFeed({ date: opts.date, fixture: opts.fixture, max: opts.max });
  if (fetched.count === 0) {
    console.log(`[weekly] ${fetched.week.week} 沒有新文章，跳過本週影片。`);
    await writeState(cfg, fetched.week.week, 0, undefined);
    return;
  }
  const weekId = fetched.week.week;

  // Stage 2: summarize
  await runSummarize({ week: weekId });
  // Stage 3: tts
  await runTts({ week: weekId });
  // Stage 4+5: storyboard
  await runStoryboard({ week: weekId });

  let outputLocation;
  if (!opts.skipRender) {
    // Stage 6: render
    ({ outputLocation } = await runRender({ week: weekId }));
    // Stage 7: qa
    if (!opts.skipQa) {
      await runQa({ week: weekId, video: outputLocation });
    }
  }

  await writeState(cfg, weekId, fetched.count, outputLocation);
  console.log(`=== 完成（${((Date.now() - t0) / 1000).toFixed(0)}s）===`);
  if (outputLocation) console.log(`成品：${outputLocation}`);
}

async function writeState(cfg, week, articleCount, video) {
  const state = await readState(cfg.dataDir);
  const articlesFile = join(cfg.dataDir, "issues", week, "articles.json");
  let guids = state.processedGuids;
  try {
    const data = JSON.parse(await readFile(articlesFile, "utf8"));
    const newGuids = data.articles.map((a) => a.guid);
    guids = [...new Set([...guids, ...newGuids])].slice(-500);
  } catch { /* 無 articles.json 時保留原 state */ }
  state.processedGuids = guids;
  state.updatedAt = new Date().toISOString();
  state.weeks = [
    ...state.weeks.filter((w) => w.week !== week),
    { week, articles: articleCount, video },
  ].slice(-52);
  await writeFile(join(cfg.dataDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  console.log(`[state] 已更新（${guids.length} 筆 GUID）`);
}

main().catch((err) => {
  console.error("[weekly] 失敗：", errMsg(err));
  process.exit(1);
});
