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

const BROWSER_HEADERS = {
  "User-Agent": "",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

/** python3 urllib 抓取（其 TLS 指紋可通過 mobileai.net 的 Cloudflare；
 *  Ubuntu curl(OpenSSL 3.0) 與 node fetch(undici) 的指紋都會被挑戰）。 */
async function httpGetPython(url, userAgent, outFile) {
  const script = `
import sys, urllib.request, urllib.error
url, ua, out = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else None)
req = urllib.request.Request(url, headers={
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Upgrade-Insecure-Requests": "1",
})
try:
    r = urllib.request.urlopen(req, timeout=30)
    data = r.read()
    if out:
        open(out, "wb").write(data)
    else:
        sys.stdout.buffer.write(data)
    print("\\nPYHTTP_STATUS", r.status)
except urllib.error.HTTPError as e:
    print("\\nPYHTTP_STATUS", e.code, file=sys.stderr)
    sys.exit(2)
`;
  const args = ["-c", script, url, userAgent];
  if (outFile) args.push(outFile);
  try {
    const { stdout } = await pexec("python3", args, { maxBuffer: 20 * 1024 * 1024 });
    const m = stdout.match(/\nPYHTTP_STATUS (\d{3})/);
    const code = Number.parseInt(m?.[1] ?? "0", 10);
    if (code >= 400) {
      throw Object.assign(new Error(`HTTP ${code} ${url}`), { retryable: code >= 500 || code === 429 });
    }
    return outFile ? "" : stdout.replace(/\nPYHTTP_STATUS \d{3}\n?$/, "");
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : "";
    const statusMatch = stderr.match(/PYHTTP_STATUS (\d{3})/);
    if (statusMatch) {
      const code = Number.parseInt(statusMatch[1], 10);
      throw Object.assign(new Error(`HTTP ${code} ${url}`), { retryable: code >= 500 || code === 429 });
    }
    // python3 不存在或腳本異常 → 退回 curl
    throw Object.assign(new Error(`python http 不可用：${errMsg(err)}`), { noPython: true });
  }
}

/** curl 抓取（headers 同上）。 */
async function httpGetCurl(url, userAgent, outFile) {
  const headers = ["-A", userAgent];
  for (const [k, v] of Object.entries(BROWSER_HEADERS)) {
    if (!v) continue;
    headers.push("-H", `${k}: ${v}`);
  }
  const args = ["-sSL", "--compressed", "--max-time", "30", ...headers, "-w", "\n%{http_code}"];
  if (outFile) args.push("-o", outFile);
  const { stdout } = await pexec("curl", [...args, url], { maxBuffer: 20 * 1024 * 1024 });
  const body = outFile ? "" : stdout.replace(/\n(\d{3})$/, "");
  const code = Number.parseInt((stdout.match(/\n(\d{3})$/) || [])[1] ?? "0", 10);
  if (code >= 400) {
    throw Object.assign(new Error(`HTTP ${code} ${url}`), { retryable: code >= 500 || code === 429 });
  }
  return body;
}

/**
 * HTTP 抓取：python3 urllib → curl → node fetch 依序嘗試。
 * mobileai.net 的 Cloudflare 以 TLS 指紋挑戰：Ubuntu curl 與 undici 會被擋、
 * python urllib 實測可過（家用 IP 與 runner 容器皆 200）。
 */
async function httpGet(url, userAgent, opts = {}) {
  // 1) python3 urllib（TLS 指紋可過 Cloudflare；HTTP 層錯誤直接拋出交給重試）
  try {
    return await httpGetPython(url, userAgent, opts.outFile);
  } catch (err) {
    if (!err?.noPython) throw err;
  }
  // 2) curl（python 不可用時）
  try {
    return await httpGetCurl(url, userAgent, opts.outFile);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  // 3) node fetch
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

/** 網路抓取 + 指數退避重試。 */
async function fetchText(url, userAgent) {
  return withRetry(() => httpGet(url, userAgent), {
    label: `fetch ${url}`,
    retries: 3,
    retryOn: (err) => err?.retryable !== false,
  });
}

/** 圖片下載：best-effort。mobileai.net 的 wp-content 有獨立 Cloudflare JS 挑戰
 *（wp-json/文章頁沒有），headless 環境解不了 → 失敗時降級為無圖（漸層卡）。 */
async function downloadImage(url, outfile, userAgent) {
  try {
    await withRetry(
      async () => {
        await httpGet(url, userAgent, { outFile: outfile });
        const { stat, open } = await import("node:fs/promises");
        const size = (await stat(outfile)).size;
        if (size < 2048) {
          throw Object.assign(new Error(`圖片過小（${size}B）：${url}`), { retryable: true });
        }
        // 驗證 magic bytes：挑戰頁以 HTML 回應（size 可能大於 2048）
        const fh = await open(outfile, "r");
        let ok;
        try {
          const { buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
          ok =
            (buffer[0] === 0xff && buffer[1] === 0xd8) || // JPEG
            buffer.toString("ascii", 1, 4) === "PNG" ||
            buffer.toString("ascii", 0, 3) === "GIF" ||
            buffer.toString("ascii", 0, 4) === "RIFF"; // WebP
        } finally {
          await fh.close();
        }
        if (!ok) {
          throw Object.assign(new Error(`回應非圖片（疑為 Cloudflare 挑戰頁）：${url}`), {
            retryable: false, // 挑戰頁重試無意義，直接放棄走降級
          });
        }
      },
      { label: `img ${url}`, retries: 1, retryOn: (err) => err?.retryable === true },
    );
    return true;
  } catch (err) {
    console.warn(`[fetch] ⚠ 圖片跳過（降級為漸層卡）：${errMsg(err)}`);
    await import("node:fs/promises").then(({ unlink }) => unlink(outfile).catch(() => {}));
    return false;
  }
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
    if (article.imageUrl) {
      const ext = imageExtFromUrl(article.imageUrl);
      const localAbs = join(week.assetsDir, "img", `img-${String(i + 1).padStart(2, "0")}${ext}`);
      const got = await downloadImage(article.imageUrl, localAbs, cfg.userAgent);
      if (got) article.localImage = `${week.relAssetsDir}/img/${basename(localAbs)}`;
    }
    console.log(
      `[fetch] (${i + 1}/${items.length}) ✓ ${article.title.slice(0, 26)}… 全文 ${article.contentText.length} 字${article.localImage ? "＋圖" : "（無圖，漸層卡）"}`,
    );
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
