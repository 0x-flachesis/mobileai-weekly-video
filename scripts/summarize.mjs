#!/usr/bin/env node
/**
 * Stage 2 — LLM 撰稿：每篇短標/口白/分類 + 開場/結尾。
 * 輸入：data/issues/<week>/articles.json
 * 輸出：data/issues/<week>/copy.json
 */
import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadConfig } from "./lib/config.ts";
import { createLLM } from "./lib/llm/factory.ts";
import { errMsg } from "./lib/util.ts";

export async function runSummarize(opts = {}) {
  const cfg = loadConfig();
  const weekId = opts.week ?? resolveWeekForLatest();
  const weekDir = join(cfg.dataDir, "issues", weekId);
  const articles = JSON.parse(await readFile(join(weekDir, "articles.json"), "utf8"));
  if (!articles.articles.length) {
    throw new Error(`[summarize] ${weekId} 沒有文章，跳過`);
  }

  const llm = createLLM(cfg.llm);
  console.log(`[summarize] LLM provider = ${llm.name}，文章數 = ${articles.articles.length}`);
  const inputs = articles.articles.map((a) => ({
    guid: a.guid,
    title: a.title,
    link: a.link,
    publishedISO: a.publishedISO,
    categories: a.categories,
    excerpt: a.excerpt,
    contentText: a.contentText,
    imageUrl: a.imageUrl,
  }));
  const copies = await llm.generateSummaries(inputs);
  const introOutro = await llm.generateIntroOutro({
    week: weekId,
    dateLabel: articles.dateLabel,
    articleTitles: inputs.map((a) => a.title),
  });

  const out = {
    week: weekId,
    dateLabel: articles.dateLabel,
    ...introOutro,
    articles: inputs.map((a, i) => ({
      guid: a.guid,
      title: a.title,
      link: a.link,
      publishedISO: a.publishedISO,
      localImage: articles.articles[i].localImage,
      copy: copies[i],
    })),
  };
  const outFile = join(weekDir, "copy.json");
  await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[summarize] 寫入 ${outFile}`);
  return { copyFile: outFile, out };
}

/** 沒指定週次時，取 data/issues 下最新的目錄。 */
function resolveWeekForLatest() {
  const dirs = readdirSync(join(loadConfig().dataDir, "issues"), { withFileTypes: true })
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
  runSummarize({ week: i === -1 ? undefined : args[i + 1] }).catch((err) => {
    console.error("[summarize] 失敗：", errMsg(err));
    process.exit(1);
  });
}
