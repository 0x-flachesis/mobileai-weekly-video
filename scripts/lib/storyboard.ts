/**
 * Storyboard 型別與純數學（節拍對齊、字幕切分）。
 * 本檔同時被 Node 腳本與 Remotion src 引用，不得引入 node: 或 DOM 依賴。
 */

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export interface Caption {
  text: string;
  /** 相對於所在 segment 的起始 frame */
  from: number;
  duration: number;
}

export interface IntroSegment {
  kind: "intro";
  from: number;
  duration: number;
  title: string;
  dateLabel: string;
  week: string;
  articleCount: number;
  /** 相對 public/ 的音檔路徑 */
  audio?: string;
  audioDurationSec: number;
}

export interface KenBurnsSpec {
  fromScale: number;
  toScale: number;
  fromX: number; // -1..1 位移比例
  fromY: number;
  toX: number;
  toY: number;
}

export interface ArticleSegment {
  kind: "article";
  index: number; // 0-based
  from: number;
  duration: number;
  articleTitle: string;
  headline: string; // 短標
  tag: string;
  link: string;
  /** 相對 public/ 的圖片路徑；無圖為 undefined（版面退回主題色漸層） */
  image?: string;
  kenburns: KenBurnsSpec;
  audio?: string;
  audioDurationSec: number;
  captions: Caption[];
}

export interface OutroSegment {
  kind: "outro";
  from: number;
  duration: number;
  headlines: string[];
  site: string;
  audio?: string;
  audioDurationSec: number;
}

export type Segment = IntroSegment | ArticleSegment | OutroSegment;

export interface SfxPin {
  name: "whoosh" | "impact" | "riser";
  atFrame: number;
  volume: number;
}

export interface Storyboard {
  schemaVersion: 2;
  week: string;
  dateISO: string;
  dateLabel: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  bgm: { src: string; volume: number; bpm: number; fadeOutFrames: number };
  segments: Segment[];
  sfx: SfxPin[];
  /** 種子（mulberry32），保證每週渲染可重現 */
  seed: number;
}

export interface BeatGrid {
  bpm: number;
  fps: number;
  framesPerBeat: number;
}

export function makeBeatGrid(bpm: number, fps: number = FPS): BeatGrid {
  return { bpm, fps, framesPerBeat: (60 / bpm) * fps };
}

/** 吸附到最近的節拍 frame。 */
export function snapToBeat(frame: number, grid: BeatGrid): number {
  const beats = Math.round(frame / grid.framesPerBeat);
  return Math.round(beats * grid.framesPerBeat);
}

/** 吸附後與原始 frame 的誤差（frames）。 */
export function snapError(frame: number, grid: BeatGrid): number {
  return Math.abs(snapToBeat(frame, grid) - frame);
}

const CUE_SPLIT = /(?<=[。！？！?，,、；;：:])/;

/** 將旁白文字切成字幕 cue：先按標點斷句、再包裝成 ≤ maxChars 的段，長度按字數比例分配時間。 */
export function buildCaptions(text: string, audioFrames: number, maxChars = 16, leadIn = 6): Caption[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || audioFrames <= 0) return [];
  const pieces = clean
    .split(CUE_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  const cues: string[] = [];
  for (const piece of pieces) {
    // 顯示時去掉句尾標點（藥丸字幕視覺較乾淨）
    const display = piece.replace(/[，,、；;：:。！？!?]+$/u, "");
    if (display.length <= maxChars) {
      cues.push(display);
      continue;
    }
    for (let i = 0; i < display.length; i += maxChars) {
      cues.push(display.slice(i, i + maxChars));
    }
  }
  const totalChars = cues.reduce((n, c) => n + c.length, 0);
  const usable = Math.max(audioFrames - leadIn, cues.length * 8);
  const rawDur = cues.map((cueText) =>
    Math.max(8, Math.round((cueText.length / totalChars) * usable)),
  );
  // 四捨五入可能讓總長超出語音範圍：由後往前收斂
  let overflow = leadIn + rawDur.reduce((a, b) => a + b, 0) - audioFrames;
  for (let i = rawDur.length - 1; i >= 0 && overflow > 0; i--) {
    const cut = Math.min(rawDur[i] - 8, overflow);
    rawDur[i] -= cut;
    overflow -= cut;
  }
  let cursor = leadIn;
  return cues.map((cueText, i) => {
    const caption: Caption = { text: cueText, from: cursor, duration: rawDur[i] };
    cursor += rawDur[i];
    return caption;
  });
}

/** 短標智慧斷行：中日文逐字、英數整詞為單位，避免把英文單字切半。 */
export function wrapHeadline(text: string, maxChars: number, maxLines = 3): string[] {
  const tokens: string[] = [];
  for (const seg of text.split(/\s+/)) {
    if (!seg) continue;
    // 拉丁字組（英數、連字號）視為一個詞；其餘（中日文、全形標點）逐字
    for (const word of seg.match(/[A-Za-z0-9][A-Za-z0-9\-+.']*|[^\s]/gu) ?? []) {
      tokens.push(word);
    }
  }
  const lines: string[] = [];
  let line = "";
  let lineLen = 0;
  for (const tok of tokens) {
    if (lineLen > 0 && lineLen + tok.length > maxChars) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = "";
      lineLen = 0;
    }
    line += tok;
    lineLen += tok.length;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [text];
}

/** 依 index 產生 KenBurns 運鏡參數（確定性：seed → PRNG）。 */
export function kenburnsFor(seed: number): KenBurnsSpec {  // mulberry32
  let a = seed >>> 0;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dirs: Array<[number, number]> = [
    [0, 0],
    [0.5, 0.2],
    [-0.5, 0.2],
    [0.3, -0.4],
    [-0.3, 0.4],
  ];
  const [dx, dy] = dirs[Math.floor(rnd() * dirs.length) % dirs.length];
  const zoomIn = rnd() > 0.35;
  const fromScale = zoomIn ? 1.04 + rnd() * 0.03 : 1.14 + rnd() * 0.04;
  const toScale = zoomIn ? 1.14 + rnd() * 0.04 : 1.04 + rnd() * 0.03;
  return {
    fromScale,
    toScale,
    fromX: dx * rnd(),
    fromY: dy * rnd(),
    toX: dx * (1 - rnd() * 0.4),
    toY: dy * (1 - rnd() * 0.4),
  };
}
