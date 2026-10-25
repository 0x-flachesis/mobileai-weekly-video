#!/usr/bin/env node
/**
 * Stage 1 — 抓取 RSS feed，過濾過去一週新文章，並到文章頁面抽取 og:image 與內文。
 * 輸出：data/issues/<week>/articles.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { loadConfig } from "./lib/config.ts";
import { resolveWeek } from "./lib/week.ts";
import { errMsg, withRetry } from "./lib/util.ts";

const pexec = promisify(execFile);

/**
 * HTTP 抓取：優先走 curl（mobileai.net 的 Cloudflare 會擋 node fetch 的 TLS 指紋），
 * curl 不可用時退回 node fetch。binary=true 時以 -o 直接寫檔。
 */
async function httpGet(url, userAgent, opts = {}) {
  try {
    const args = ["-sSL", "--compressed", "--max-time", "30", "-A", userAgent, "-w", "\n%{http_code}"];
    if (opts.outFile) args.push("-o", opts.outFile);
    const { stdout } = await pexec("curl", [...args, url], { maxBuffer: 20 * 1024 * 1024 });
    const body = opts.outFile ? "" : stdout.replace(/\n(\d{3})$/, "");
    const code = Number.parseInt((stdout.match(/\n(\d{3})$/) || [])[1] ?? "0", 10);
    if (code >= 400) {
      throw Object.assign(new Error(`HTTP ${code} ${url}`), { retryable: code >= 500 || code === 429 });
    }
    return body;
  } catch (err) {
    if (err.code === "ENOENT") {
      // 無 curl：退回 node fetch
      const res = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} ${url}`), {
          retryable: res.status >= 500 || res.status === 429,
        });
      }
      if (opts.outFile) {
        await writeFile(opts.outFile, Buffer.from(await res.arrayBuffer()));
        return "";
      }
      return await res.text();
    }
    throw err;
  }
}

/** 網路抓取 + 指數退避重試。 */
async function fetchText(url, userAgent) {
  return withRetry(() => httpGet(url, userAgent), {
    label: `fetch ${url}`,
    retries: 3,
    retryOn: (err) => err?.retryable !== false,
  });
}

async function downloadImage(url, outfile, userAgent) {
  await withRetry(
    async () => {
      await httpGet(url, userAgent, { outFile: outfile });
      const { stat } = await import("node:fs/promises");
      const size = (await stat(outfile)).size;
      if (size < 2048) {
        throw Object.assign(new Error(`圖片過小（${size}B）：${url}`), { retryable: true });
      }
    },
    { label: `img ${url}`, retries: 2, retryOn: (err) => err?.retryable !== false },
  );
}

function imageExtFromUrl(url) {
  const m = basename(new URL(url).pathname).match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? `.${m[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

/** 從文章 HTML 抽取 og:image 與內文文字。 */
export function extractArticle(html) {
  const $ = cheerio.load(html);
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || undefined;
  const contentRoot =
    $(".entry-content").first().length
      ? $(".entry-content").first()
      : $("article").first().length
        ? $("article").first()
        : $("body");
  contentRoot.find("script, style, noscript, iframe, .sharedaddy, .jp-relatedposts").remove();
  const contentText = contentRoot
    .text()
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { ogImage, contentText: contentText.slice(0, 3000) };
}

export async function runFetchFeed(opts = {}) {
  const cfg = loadConfig();
  const runDate = opts.date ? new Date(`${opts.date}T09:00:00+08:00`) : new Date();
  const week = resolveWeek(runDate, { dataDir: cfg.dataDir, publicAssetsDir: cfg.publicAssetsDir, lookbackDays: cfg.lookbackDays });

  let xml;
  if (opts.fixture) {
    xml = await readFile(opts.fixture, "utf8");
    console.log(`[fetch] 使用 fixture：${opts.fixture}`);
  } else {
    console.log(`[fetch] 抓取 ${cfg.feedUrl}`);
    xml = await fetchText(cfg.feedUrl, cfg.userAgent);
  }

  const parser = new Parser({ customFields: { item: [["dc:creator", "creator"]] } });
  const feed = await parser.parseString(xml);
  const windowStart = new Date(week.windowStartISO).getTime();
  const windowEnd = new Date(week.windowEndISO).getTime();

  let items = feed.items.filter((it) => {
    const t = it.isoDate ? new Date(it.isoDate).getTime() : new Date(it.pubDate).getTime();
    return t >= windowStart && t < windowEnd;
  });
  // 舊到新排序，影片按時間敘事
  items.sort((a, b) => new Date(a.isoDate ?? a.pubDate) - new Date(b.isoDate ?? b.pubDate));
  if (opts.max) items = items.slice(0, opts.max);
  console.log(`[fetch] 視窗 ${week.windowStartISO} ~ ${week.windowEndISO}，共 ${items.length} 篇新文章（feed 全部 ${feed.items.length} 篇）`);

  await mkdir(join(week.assetsDir, "img"), { recursive: true });
  await mkdir(week.weekDir, { recursive: true });

  const articles = [];
  for (const [i, it] of items.entries()) {
    const publishedISO = it.isoDate ?? new Date(it.pubDate).toISOString();
    const article = {
      guid: it.guid ?? it.link,
      title: (it.title ?? "").trim(),
      link: it.link,
      publishedISO,
      author: it.creator ?? it.author ?? "",
      categories: (it.categories ?? []).map((c) => String(c)),
      excerpt: (it.contentSnippet ?? it.content ?? "").trim(),
      contentText: "",
      imageUrl: undefined,
      localImage: undefined,
    };
    try {
      const html = await fetchText(article.link, cfg.userAgent);
      const { ogImage, contentText } = extractArticle(html);
      article.contentText = contentText;
      article.imageUrl = ogImage;
      if (!article.excerpt) article.excerpt = contentText.slice(0, 160);
      if (ogImage) {
        const ext = imageExtFromUrl(ogImage);
        const localAbs = join(week.assetsDir, "img", `img-${String(i + 1).padStart(2, "0")}${ext}`);
        await downloadImage(ogImage, localAbs, cfg.userAgent);
        article.localImage = `${week.relAssetsDir}/img/${basename(localAbs)}`;
        console.log(`[fetch] (${i + 1}/${items.length}) ✓ ${article.title.slice(0, 30)}… 圖片已下載`);
      } else {
        console.log(`[fetch] (${i + 1}/${items.length}) ✓ ${article.title.slice(0, 30)}… （無 og:image）`);
      }
    } catch (err) {
      // 文章頁失敗只降級（無圖、無內文），仍以 RSS 資料收錄
      console.warn(`[fetch] (${i + 1}/${items.length}) ⚠ 文章頁抽取失敗，降級使用 RSS 資料：${errMsg(err)}`);
    }
    articles.push(article);
  }

  const out = {
    week: week.week,
    dateISO: week.runDateISO,
    dateLabel: week.dateLabel,
    windowStartISO: week.windowStartISO,
    windowEndISO: week.windowEndISO,
    feedUrl: opts.fixture ? `fixture:${opts.fixture}` : cfg.feedUrl,
    articles,
  };
  const outFile = join(week.weekDir, "articles.json");
  await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[fetch] 寫入 ${outFile}（${articles.length} 篇）`);
  return { week, articlesFile: outFile, count: articles.length, out };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const args = process.argv.slice(2);
  const getOpt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  runFetchFeed({
    date: getOpt("date"),
    fixture: getOpt("fixture"),
    max: getOpt("max") ? Number.parseInt(getOpt("max"), 10) : undefined,
  }).catch((err) => {
    console.error("[fetch] 失敗：", errMsg(err));
    process.exit(1);
  });
}
