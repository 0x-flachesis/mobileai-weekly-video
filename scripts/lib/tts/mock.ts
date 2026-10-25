import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { probeDurationSec } from "../audio.ts";
import type { TTSMockConfig } from "../config.ts";
import type { SynthOptions, SynthResult, TTSProvider } from "./types.ts";

const pexec = promisify(execFile);

/** 產生固定長度靜音 MP3（長度依字數估算），供 dry-run 與單元測試，不需網路。 */
export class MockTTS implements TTSProvider {
  readonly name = "mock";
  cfg: TTSMockConfig;

  constructor(cfg: TTSMockConfig) {
    this.cfg = cfg;
  }

  async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
    await mkdir(dirname(opts.outfile), { recursive: true });
    const estSec = Math.max(1.2, text.length / this.cfg.charsPerSecond + 0.4);
    await pexec("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=32000:cl=mono",
      "-t",
      estSec.toFixed(2),
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "9",
      opts.outfile,
    ]);
    const durationSec = await probeDurationSec(opts.outfile);
    return { audioPath: opts.outfile, durationSec };
  }
}
