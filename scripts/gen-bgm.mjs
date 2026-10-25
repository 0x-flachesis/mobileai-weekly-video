#!/usr/bin/env node
/**
 * 一次性資產產生器：以純數學合成三首 BGM（WAV → MP3）。
 * 自製音樂＝無版權問題；BPM 已知＝節拍位置精確，無需事後偵測。
 * 決定性：seeded PRNG，重跑結果一致。
 *
 * 用法：node scripts/gen-bgm.mjs
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
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

const midi2hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ---------- 音色（以「事件渲染」方式寫入 buffer） ---------- */

/** 打擊樂以「事件渲染」方式寫入 buffer，避免相位積分 per-sample 重复。 */
function renderKick(buf, startSample, gain, rnd) {
  const len = Math.floor(0.35 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    const f = 45 + 115 * Math.exp(-t * 24);
    phase += (2 * Math.PI * f) / SR;
    const body = Math.sin(phase) * Math.exp(-t * 6.5);
    const click = (rnd() * 2 - 1) * Math.exp(-t * 220) * 0.35;
    buf[idx] += (body + click) * gain;
  }
}

function renderHat(buf, startSample, gain, decay, rnd) {
  const len = Math.floor((decay * 4) * SR);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    const n = rnd() * 2 - 1;
    const hp = n - prev; // 一階差分近似 highpass，突出高頻
    prev = n;
    buf[idx] += hp * Math.exp(-t / decay) * gain;
  }
}

function renderClap(buf, startSample, gain, rnd) {
  for (const offset of [0, 0.011, 0.023]) {
    const s = startSample + Math.floor(offset * SR);
    const len = Math.floor(0.12 * SR);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const idx = s + i;
      if (idx >= buf.length) break;
      const t = i / SR;
      const n = rnd() * 2 - 1;
      const hp = n - prev;
      prev = n;
      // 簡易帶通：差分後再做一次平滑
      buf[idx] += hp * 0.5 * Math.exp(-t * 26) * gain * 0.7;
    }
  }
}

function renderBassNote(buf, startSample, durSec, freq, gain, duck) {
  const len = Math.floor(durSec * SR);
  const atk = Math.floor(0.008 * SR);
  const rel = Math.floor(0.05 * SR);
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    let env = 1;
    if (i < atk) env = i / atk;
    if (i > len - rel) env = Math.min(env, (len - i) / rel);
    const ph = (2 * Math.PI * freq * i) / SR;
    const wave = Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
    buf[idx] += wave * env * gain * duck[idx];
  }
}

/** 柔和鋸齒近似（前 5 個諧波遞減）+ detune 雙振盪器。 */
function renderPadNote(buf, startSample, durSec, freq, gain, attackSec, duck) {
  const len = Math.floor(durSec * SR);
  const atk = Math.floor(attackSec * SR);
  const rel = Math.floor(0.45 * SR);
  const detune = 1.0028;
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    let env = 1;
    if (i < atk) env = i / atk;
    if (i > len - rel) env = Math.min(env, (len - i) / rel);
    const t = i / SR;
    const ph1 = 2 * Math.PI * freq * t;
    const ph2 = 2 * Math.PI * freq * detune * t;
    const h = (ph) => Math.sin(ph) + 0.42 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph) + 0.09 * Math.sin(4 * ph);
    // 一階低pass：衰減高頻抖動
    const raw = (h(ph1) + h(ph2)) * 0.5 * env * gain * duck[idx];
    buf[idx] += raw;
  }
}

function renderPluck(buf, startSample, freq, gain) {
  const len = Math.floor(0.28 * SR);
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    const ph = (2 * Math.PI * freq * t);
    const wave = Math.sin(ph) + 0.18 * Math.sin(2 * ph);
    buf[idx] += wave * Math.exp(-t * 9) * gain;
  }
}

/* ---------- 編曲 ---------- */

const TRACKS = [
  {
    name: "bgm-uplift-110",
    bpm: 110,
    seed: 20261019,
    bars: [
      { pad: [60, 64, 67, 71], bass: 36 }, // Cmaj7
      { pad: [55, 59, 62, 67], bass: 43 }, // G
      { pad: [57, 60, 64, 67], bass: 45 }, // Am7
      { pad: [53, 57, 60, 64], bass: 41 }, // Fmaj7
    ],
    kick: [0, 1, 2, 3],
    clap: [1, 3],
    hats: "eighths",
    arp: "half-bars",
    padAttack: 0.28,
    duckDepth: 0.5,
    levels: { kick: 0.85, bass: 0.4, pad: 0.3, hat: 0.14, clap: 0.22, arp: 0.2 },
  },
  {
    name: "bgm-focus-100",
    bpm: 100,
    seed: 20261020,
    bars: [
      { pad: [57, 60, 64, 67], bass: 45 }, // Am7
      { pad: [53, 57, 60, 64], bass: 41 }, // Fmaj7
      { pad: [60, 64, 67, 71], bass: 36 }, // Cmaj7
      { pad: [55, 59, 62, 67], bass: 43 }, // G
    ],
    kick: [0, 2],
    clap: [],
    hats: "quarters",
    arp: "none",
    padAttack: 0.8,
    duckDepth: 0.32,
    levels: { kick: 0.8, bass: 0.42, pad: 0.36, hat: 0.1, clap: 0, arp: 0 },
  },
  {
    name: "bgm-pulse-120",
    bpm: 120,
    seed: 20261021,
    bars: [
      { pad: [53, 57, 60, 64], bass: 41 },
      { pad: [60, 64, 67, 71], bass: 36 },
      { pad: [55, 59, 62, 67], bass: 43 },
      { pad: [57, 60, 64, 67], bass: 45 },
    ],
    kick: [0, 1, 2, 3],
    clap: [1, 3],
    hats: "eighths-open",
    arp: "all",
    padAttack: 0.2,
    duckDepth: 0.55,
    levels: { kick: 0.88, bass: 0.38, pad: 0.26, hat: 0.15, clap: 0.24, arp: 0.22 },
  },
];

const MIN_SECONDS = 132;

function synthTrack(track) {
  const rnd = mulberry32(track.seed);
  const spb = 60 / track.bpm; // sec per beat
  const barSec = spb * 4;
  const totalBars = Math.ceil(MIN_SECONDS / barSec);
  const totalSamples = Math.ceil(totalBars * barSec * SR);
  const buf = new Float32Array(totalSamples);

  // 先記下 kick 事件，建立 sidechain duck envelope
  const kickSamples = [];
  for (let bar = 0; bar < totalBars; bar++) {
    for (const beat of track.kick) {
      kickSamples.push(Math.floor((bar * barSec + beat * spb) * SR));
    }
  }
  const duck = new Float32Array(totalSamples).fill(1);
  const tau = 0.085 * SR;
  let lastKick = -Infinity;
  for (let i = 0; i < totalSamples; i++) {
    while (kickSamples.length && kickSamples[0] <= i) lastKick = kickSamples.shift();
    const since = i - lastKick;
    duck[i] = 1 - track.duckDepth * Math.exp(-since / tau);
  }

  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = Math.floor(bar * barSec * SR);
    const chord = track.bars[bar % track.bars.length];
    const L = track.levels;

    for (const beat of track.kick) {
      renderKick(buf, barStart + Math.floor(beat * spb * SR), L.kick * (0.94 + rnd() * 0.06), rnd);
    }
    for (const beat of track.clap) {
      renderClap(buf, barStart + Math.floor(beat * spb * SR), L.clap, rnd);
    }
    if (track.hats !== "none") {
      const step = track.hats === "quarters" ? spb : spb / 2;
      for (let t = 0; t < barSec - 1e-6; t += step) {
        const open = track.hats === "eighths-open" && Math.abs((t / spb) % 2 - 1) < 1e-6;
        renderHat(buf, barStart + Math.floor(t * SR), L.hat * (0.7 + rnd() * 0.5), open ? 0.09 : 0.028, rnd);
      }
    }
    // Bass：每拍切音
    for (let beat = 0; beat < 4; beat++) {
      renderBassNote(buf, barStart + Math.floor(beat * spb * SR), spb * 0.92, midi2hz(chord.bass), L.bass, duck);
    }
    // Pad：整小節（尾巴 release 疊到下一小節）
    for (const note of chord.pad) {
      renderPadNote(buf, barStart, barSec + 0.4, midi2hz(note), L.pad, track.padAttack, duck);
    }
    // Arp：16 分音符爬和弦
    const arpOn =
      track.arp === "all" || (track.arp === "half-bars" && bar % 4 >= 2);
    if (arpOn) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      const tones = [...chord.pad, chord.pad[0] + 12];
      for (let s = 0; s < 16; s++) {
        const note = tones[pattern[s % pattern.length] % tones.length];
        renderPluck(buf, barStart + Math.floor((s * spb * SR) / 4), midi2hz(note), L.arp * (0.75 + rnd() * 0.4));
      }
    }
  }

  // master：fade-in + soft clip
  const fadeIn = Math.floor(1.2 * SR);
  for (let i = 0; i < totalSamples; i++) {
    let v = buf[i];
    if (i < fadeIn) v *= i / fadeIn;
    buf[i] = Math.tanh(v * 1.1) * 0.92;
  }
  return buf;
}

function writeWav(samples, sr) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
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

async function main() {
  const outDir = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "public/bgm";
  await mkdir(outDir, { recursive: true });
  const manifest = [];
  for (const track of TRACKS) {
    console.log(`[gen-bgm] 合成 ${track.name}（${track.bpm} BPM）…`);
    const samples = synthTrack(track);
    const wavFile = join(outDir, `${track.name}.wav`);
    await writeFile(wavFile, writeWav(samples, SR));
    const mp3File = join(outDir, `${track.name}.mp3`);
    await pexec("ffmpeg", ["-y", "-loglevel", "error", "-i", wavFile, "-codec:a", "libmp3lame", "-q:a", "3", mp3File]);
    const { stat, unlink } = await import("node:fs/promises");
    const size = (await stat(mp3File)).size;
    await unlink(wavFile);
    const dur = samples.length / SR;
    manifest.push({ name: track.name, file: `${track.name}.mp3`, bpm: track.bpm, durationSec: Math.round(dur), bytes: size });
    console.log(`[gen-bgm] ✓ ${mp3File}（${(size / 1024 / 1024).toFixed(1)}MB, ${dur.toFixed(0)}s）`);
  }
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[gen-bgm] manifest 寫入 ${join(outDir, "manifest.json")}`);
}

main().catch((err) => {
  console.error("[gen-bgm] 失敗：", err);
  process.exit(1);
});
