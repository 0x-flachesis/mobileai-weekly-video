#!/usr/bin/env node
/**
 * Stage 8 — 將本週影片發布到 GitHub Release（MP4 + SRT 字幕 + 自動生成說明）。
 * Release 冪等：同 tag 重跑會更新說明並覆蓋同名資產，不會重複建立。
 *
 * 用法：
 *   node scripts/publish-release.mjs                # 依 data/state.json 最新一週
 *   node scripts/publish-release.mjs 2026-W43       # 指定週
 *   node scripts/publish-release.mjs --dry-run      # 只印說明與產生 SRT，不呼叫 GitHub API
 *
 * 環境變數：GITHUB_TOKEN、GITHUB_REPOSITORY、GITHUB_SHA（GitHub Actions 自帶，本機測試用 --dry-run）
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { errMsg } from "./lib/util.ts";

const API = "https://api.github.com";
const DEFAULT_REPO = "0x-flachesis/mobileai-weekly-video";

function parseArgs(argv) {
  const opts = {};
  for (const a of argv) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (!a.startsWith("--")) opts.week = a;
    else {
      console.error(`未知參數：${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** frames → SRT 時間碼「00:00:06,200」 */
function srtTime(frames, fps) {
  const ms = Math.round((frames / fps) * 1000);
  return `${pad2(Math.floor(ms / 3_600_000))}:${pad2(Math.floor((ms % 3_600_000) / 60_000))}:${pad2(
    Math.floor((ms % 60_000) / 1000),
  )},${String(ms % 1000).padStart(3, "0")}`;
}

/** frames →「1:30」 */
function mmss(frames, fps) {
  const s = Math.round(frames / fps);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

function segLabel(seg) {
  if (seg.kind === "intro") return "開場";
  if (seg.kind === "outro") return "結尾";
  return seg.headline || seg.articleTitle || `焦點 ${seg.index + 1}`;
}

/** 影片說明（Release body）：規格、文章清單、完整旁白稿。 */
function buildNotes(sb, copy, repo) {
  const articles = sb.segments.filter((s) => s.kind === "article");
  const lines = [
    `**mobileai 週報 ${sb.week}**（${sb.dateLabel}）——由 [mobileai-weekly-video](https://github.com/${repo}) 全自動生成的每週精華影片。`,
    "",
    `- 影片：${sb.width}×${sb.height} @ ${sb.fps}fps，時長 ${mmss(sb.totalFrames, sb.fps)}`,
    `- 文章：${articles.length} 篇`,
    `- 字幕：附 SRT 檔，可直接上 YouTube 等平台`,
    "",
    "## 本週文章",
  ];
  articles.forEach((seg, i) => {
    const tag = seg.tag ? `（${seg.tag}）` : "";
    lines.push(`${i + 1}. [${seg.headline}](${seg.link}) — ${seg.articleTitle}${tag}`);
  });
  lines.push("", "## 旁白稿");
  for (const seg of sb.segments) {
    const text = segNarration(seg, copy);
    if (!text) continue;
    lines.push("", `### ${mmss(seg.from, sb.fps)} ${segLabel(seg)}`, "", text);
  }
  return lines.join("\n");
}

/** 段落旁白全文：文章段優先取 copy.json 的完整撰稿（captions 串接會失標點），開場／結尾取 copy。 */
function segNarration(seg, copy) {
  if (seg.kind === "article") {
    const c = (copy?.articles ?? []).find((a) => a.link === seg.link)?.copy;
    return c?.narration || (seg.captions ?? []).map((x) => x.text).join("");
  }
  return (seg.kind === "intro" ? copy?.intro : copy?.outro) || "";
}

/** SRT 字幕：文章段用 storyboard 的 captions（與畫面同步）；開場／結尾依配音長度合成單一 cue。 */
function buildSrt(sb, copy) {
  const cues = [];
  for (const seg of sb.segments) {
    if (seg.kind === "article") {
      for (const c of seg.captions ?? []) {
        cues.push({ from: seg.from + c.from, duration: c.duration, text: c.text.replace(/\s*\n+\s*/g, " ") });
      }
      continue;
    }
    const text = (seg.kind === "intro" ? copy?.intro : copy?.outro)?.trim();
    if (!text) continue;
    const fps = sb.fps;
    const audioFrames = Math.round((seg.audioDurationSec ?? seg.duration / fps) * fps);
    cues.push({
      from: seg.from + Math.round(fps * 0.3),
      duration: Math.max(fps, Math.min(audioFrames - fps * 0.5, seg.duration - fps * 0.6)),
      text,
    });
  }
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.from, sb.fps)} --> ${srtTime(c.from + c.duration, sb.fps)}\n${c.text}\n`,
    )
    .join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;

  // 週與影片路徑：參數指定 > state.json 最新一週（無新文章的週沒有 video，直接跳過）
  let { week, videoPath } = opts;
  if (!week || !videoPath) {
    const state = JSON.parse(await readFile(join("data", "state.json"), "utf8"));
    const last = state.weeks.at(-1);
    if (!last?.video) {
      console.log("[release] state 最新一週沒有影片（本週可能無新文章），跳過發布。");
      return;
    }
    week ??= last.week;
    videoPath ??= last.video;
  }

  const dir = join("data", "issues", week);
  const sb = JSON.parse(await readFile(join(dir, "storyboard.json"), "utf8"));
  let copy = null;
  try {
    copy = JSON.parse(await readFile(join(dir, "copy.json"), "utf8"));
  } catch { /* 無 copy.json 時旁白稿僅列文章段 */ }

  const notes = buildNotes(sb, copy, repo);
  const srtPath = join("output", `weekly-${week}.srt`);
  await mkdir("output", { recursive: true });
  await writeFile(srtPath, buildSrt(sb, copy));
  console.log(`[release] 字幕已產生：${srtPath}`);

  const candidateAssets = [
    { path: videoPath, type: "video/mp4", label: `${week} 週報影片` },
    { path: srtPath, type: "application/x-subrip", label: "SRT 字幕" },
  ];
  const uploadables = [];
  for (const a of candidateAssets) {
    if (await stat(a.path).then((s) => s.isFile()).catch(() => false)) uploadables.push(a);
    else console.warn(`[release] 找不到資產，略過：${a.path}`);
  }
  if (uploadables.length === 0) throw new Error(`沒有可發布的資產（${videoPath} 不存在）`);

  if (opts.dryRun) {
    console.log(`\n===== Release 說明（weekly-${week}）=====\n${notes}\n`);
    console.log(`資產：${uploadables.map((a) => a.path).join("、")}（dry-run 不上傳）`);
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("缺少 GITHUB_TOKEN 環境變數（CI 會自動提供）");
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const call = async (path, init = {}) => {
    const res = await fetch(`${API}/repos/${repo}${path}`, {
      ...init,
      headers: { ...headers, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(init.upload ? 300_000 : 60_000),
    });
    const body = (await res.text().catch(() => "")) || null;
    if (!res.ok) throw new Error(`GitHub API ${init.method ?? "GET"} ${path} → HTTP ${res.status}：${body?.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  };

  const tag = `weekly-${week}`;
  const name = `mobileai 週報 ${week}`;
  const existing = await call(`/releases/tags/${tag}`).catch(() => null);
  let release;
  if (existing) {
    release = await call(`/releases/${existing.id}`, { method: "PATCH", body: JSON.stringify({ name, body: notes }) });
    console.log(`[release] 更新既有 Release：${release.html_url}`);
  } else {
    release = await call("/releases", {
      method: "POST",
      body: JSON.stringify({ tag_name: tag, target_commitish: process.env.GITHUB_SHA, name, body: notes }),
    });
    console.log(`[release] 建立 Release：${release.html_url}`);
  }

  for (const a of uploadables) {
    const fileName = basename(a.path);
    // 冪等：先刪同名舊資產再上傳（GitHub 不允許同名覆蓋）
    for (const old of release.assets ?? []) {
      if (old.name === fileName) {
        await call(`/releases/assets/${old.id}`, { method: "DELETE" });
        console.log(`[release] 刪除舊資產：${fileName}`);
      }
    }
    const buf = new Uint8Array(await readFile(a.path));
    const uploadUrl = release.upload_url.replace(/\{\?[^}]*\}$/, "");
    const res = await fetch(`${uploadUrl}?name=${encodeURIComponent(fileName)}&label=${encodeURIComponent(a.label)}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": a.type },
      body: buf,
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`上傳資產 ${fileName} 失敗：HTTP ${res.status}：${(await res.text().catch(() => "")).slice(0, 300)}`);
    const asset = await res.json();
    console.log(`[release] 已上傳：${asset.name}（${(buf.length / 1024 / 1024).toFixed(1)} MB）→ ${asset.browser_download_url}`);
  }
  console.log(`[release] 完成：${release.html_url}`);
}

main().catch((err) => {
  console.error("[release] 失敗：", errMsg(err));
  process.exit(1);
});
