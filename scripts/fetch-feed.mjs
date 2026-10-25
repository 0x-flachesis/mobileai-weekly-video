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

/** 從文章 HTML 抽取 og:image 與內文文字（WP API 不可用時的 fallback）。 */
export function extractArticle(html) {
  const $ = cheerio.load(html);
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || undefined;
  const contentRoot =
    $(".entry-content").first().length
      ? $(".entry-content").first()
      : $("article .entry-content").first().length
        ? $("article .entry-content").first()
        : $(".post-content, .article-content").first().length
          ? $(".post-content, .article-content").first()
          : $("article").first().length
            ? $("article").first()
            : $("body");
  contentRoot
    .find("script, style, noscript, iframe, nav, header, footer, aside, form, .sharedaddy, .jp-relatedposts, #comments, .comments, .related-posts, .post-ratings")
    .remove();
  const contentText = contentRoot
    .text()
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    // 去除麵包屑前綴（「首頁→科技→…」）與開頭重複的標題+日期
    .replace(/^首頁(→[^ ]*)*\s*/u, "")
    .trim();
  return { ogImage, contentText: contentText.slice(0, 4000) };
}

/** HTML → 純文字（供 WP API content.rendered 使用）。 */
function htmlToText(html) {
  const $ = cheerio.load(`<div>${html ?? ""}</div>`);
  $("div").find("script, style, noscript, iframe").remove();
  return $("div")
    .text()
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 以 WordPress REST API 取得視窗內文章全文（含 _embed 的特色圖片與分類）。
 * 回傳以正規化 link 為鍵的 Map；失敗時回空 Map（fallback 到頁面抓版）。
 */
export async function fetchWpPosts(siteOrigin, windowStartISO, windowEndISO, userAgent) {
  try {
    const url = `${siteOrigin}/wp-json/wp/v2/posts?after=${encodeURIComponent(windowStartISO)}&before=${encodeURIComponent(windowEndISO)}&per_page=20&_embed`;
    const json = JSON.parse(await httpGet(url, userAgent));
    if (!Array.isArray(json)) return new Map();
    const map = new Map();
    for (const post of json) {
      const terms = (post._embedded?.["wp:term"] ?? [])
        .flat()
        .map((t) => String(t.name ?? ""))
        .filter(Boolean);
      map.set(normalizeLink(post.link), {
        contentText: htmlToText(post.content?.rendered).slice(0, 4000),
        imageUrl: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url || undefined,
        categories: terms,
        publishedISO: post.date_gmt ? `${post.date_gmt}Z` : undefined,
      });
    }
    console.log(`[fetch] WP API：${map.size} 篇全文`);
    return map;
  } catch (err) {
    console.warn(`[fetch] WP API 不可用，退回頁面抓版：${errMsg(err)}`);
    return new Map();
  }
}

function normalizeLink(link) {
  return String(link ?? "").replace(/\/+$/, "").toLowerCase();
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

  const siteOrigin = new URL(opts.fixture ? "https://mobileai.net/" : cfg.feedUrl).origin;
  const wpPosts = await fetchWpPosts(siteOrigin, week.windowStartISO, week.windowEndISO, cfg.userAgent);

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
    const wp = wpPosts.get(normalizeLink(article.link));
    if (wp) {
      article.contentText = wp.contentText;
      article.imageUrl = wp.imageUrl;
      if (wp.categories.length) article.categories = wp.categories;
      if (!article.excerpt) article.excerpt = wp.contentText.slice(0, 160);
    }
    if (!article.contentText || !article.imageUrl) {
      // WP API 沒拿到全文或圖 → 抓文章頁面補齊
      try {
        const html = await fetchText(article.link, cfg.userAgent);
        const { ogImage, contentText } = extractArticle(html);
        if (!article.contentText) article.contentText = contentText;
        if (!article.imageUrl) article.imageUrl = ogImage;
        if (!article.excerpt) article.excerpt = contentText.slice(0, 160);
      } catch (err) {
        console.warn(`[fetch] (${i + 1}/${items.length}) ⚠ 文章頁抽取失敗，降級使用 RSS 資料：${errMsg(err)}`);
      }
    }
    try {
      if (article.imageUrl) {
        const ext = imageExtFromUrl(article.imageUrl);
        const localAbs = join(week.assetsDir, "img", `img-${String(i + 1).padStart(2, "0")}${ext}`);
        await downloadImage(article.imageUrl, localAbs, cfg.userAgent);
        article.localImage = `${week.relAssetsDir}/img/${basename(localAbs)}`;
      }
      console.log(
        `[fetch] (${i + 1}/${items.length}) ✓ ${article.title.slice(0, 26)}… 全文 ${article.contentText.length} 字${article.localImage ? "＋圖" : "（無圖）"}`,
      );
    } catch (err) {
      console.warn(`[fetch] (${i + 1}/${items.length}) ⚠ 圖片下載失敗：${errMsg(err)}`);
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
