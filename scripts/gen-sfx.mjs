#!/usr/bin/env node
/**
 * 一次性資產產生器：純數學合成 SFX（無版權疑慮、決定性）。
 * 產出：public/sfx/{whoosh,impact,riser}.wav + .mp3
 *
 * 用法：node scripts/gen-sfx.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pexec = promisify(execFile);
const SR = 44100;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function writeWav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/** whoosh：噪音經一階低通掃頻（150Hz→3kHz）+ 三角包絡，1.1s。 */
function synthWhoosh() {
  const dur = 1.1;
  const n = Math.floor(dur * SR);
  const rnd = mulberry32(43);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = rnd() * 2 - 1;
    const f = 150 + 2800 * (t / dur);
    const a = 1 - Math.exp((-2 * Math.PI * f) / SR);
    lp += a * (x - lp);
    const tri = t < dur / 2 ? t / (dur / 2) : 1 - (t - dur / 2) / (dur / 2);
    out[i] = lp * tri * 2.2;
  }
  return out;
}

/** impact：低頻墜落（62→32Hz 指數衰減）+ 高頻擊觸，0.9s。 */
function synthImpact() {
  const dur = 0.9;
  const n = Math.floor(dur * SR);
  const rnd = mulberry32(7);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 62 - 30 * t;
    phase += (2 * Math.PI * f) / SR;
    const thump = Math.sin(phase) * Math.exp(-5.5 * t);
    const click = i < 0.012 * SR ? (rnd() * 2 - 1) * Math.exp(-t * 260) * 0.4 : 0;
    out[i] = (thump + click) * 1.5;
  }
  return out;
}

/** riser：噪音經一階高通掃頻上升 + 音量漸強，1.6s。 */
function synthRiser() {
  const dur = 1.6;
  const n = Math.floor(dur * SR);
  const rnd = mulberry32(11);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = rnd() * 2 - 1;
    const f = 250 + 2400 * (t / dur);
    const a = 1 - Math.exp((-2 * Math.PI * f) / SR);
    lp += a * (x - lp);
    const hp = x - lp; // 高通 = 原訊號 − 低通
    const crescendo = Math.pow(t / dur, 2.2);
    const tail = t > dur - 0.15 ? (dur - t) / 0.15 : 1;
    out[i] = hp * crescendo * tail * 1.8;
  }
  return out;
}

async function emit(name, samples, outDir) {
  const wav = join(outDir, `${name}.wav`);
  await writeFile(wav, writeWav(samples, SR));
  const mp3 = join(outDir, `${name}.mp3`);
  await pexec("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "4", mp3]);
  await unlink(wav);
  console.log(`[gen-sfx] ✓ ${mp3}（${(samples.length / SR).toFixed(2)}s）`);
}

async function main() {
  const outDir = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "public/sfx";
  await mkdir(outDir, { recursive: true });
  await emit("whoosh", synthWhoosh(), outDir);
  await emit("impact", synthImpact(), outDir);
  await emit("riser", synthRiser(), outDir);
  console.log("[gen-sfx] 完成");
}

main().catch((err) => {
  console.error("[gen-sfx] 失敗：", err);
  process.exit(1);
});
