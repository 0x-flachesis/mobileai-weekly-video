import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { probeDurationSec } from "../audio.ts";
import type { TTSEdgeConfig } from "../config.ts";
import type { SynthOptions, SynthResult, TTSProvider } from "./types.ts";

const pexec = promisify(execFile);

/**
 * Microsoft Edge 線上語音（免 API key），走 Python `edge-tts` CLI。
 * npm 的 msedge-tts 對新版端點（Sec-MS-GEC token）已失效，故以 CLI 取得。
 * 依序嘗試：EDGE_TTS_BIN → `edge-tts` → `uvx edge-tts`。
 */
export class EdgeTTS implements TTSProvider {
  readonly name = "edge";
  cfg: TTSEdgeConfig;
  resolvedBin: string[] | null = null;

  constructor(cfg: TTSEdgeConfig) {
    this.cfg = cfg;
  }

  private async detectBin(): Promise<string[]> {
    if (this.resolvedBin) return this.resolvedBin;
    const candidates: string[][] = [];
    if (process.env.EDGE_TTS_BIN) candidates.push([process.env.EDGE_TTS_BIN]);
    candidates.push(["edge-tts"], ["uvx", "edge-tts"]);
    for (const bin of candidates) {
      try {
        await pexec(bin[0], ["--version", ...bin.slice(1)].slice(0, 1 === bin.length ? 1 : 2), { timeout: 15_000 });
      } catch {
        continue;
      }
      this.resolvedBin = bin;
      return bin;
    }
    throw new Error(
      "[tts:edge] 找不到 edge-tts CLI。請 `pip install edge-tts`、安裝 uv（uvx），或以 EDGE_TTS_BIN 指定路徑",
    );
  }

  async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
    await mkdir(dirname(opts.outfile), { recursive: true });
    const bin = await this.detectBin();
    const voice = opts.voice ?? this.cfg.voice;
    await pexec(
      bin[0],
      [
        ...bin.slice(1),
        "--voice",
        voice,
        "--text",
        text,
        "--write-media",
        opts.outfile,
      ],
      { timeout: 120_000 },
    );
    const durationSec = await probeDurationSec(opts.outfile);
    return { audioPath: opts.outfile, durationSec };
  }
}
