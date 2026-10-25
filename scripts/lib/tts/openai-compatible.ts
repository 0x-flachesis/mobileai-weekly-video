import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { probeDurationSec } from "../audio.ts";
import type { TTSOpenAICompatConfig } from "../config.ts";
import type { SynthOptions, SynthResult, TTSProvider } from "./types.ts";
import { ProviderError, withRetry } from "../util.ts";

/** OpenAI 相容 /audio/speech 端點（OpenAI、LiteLLM、各家代理）。 */
export class OpenAICompatibleTTS implements TTSProvider {
  readonly name = "openai-compatible";
  cfg: TTSOpenAICompatConfig;

  constructor(cfg: TTSOpenAICompatConfig) {
    this.cfg = cfg;
  }

  async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
    await mkdir(dirname(opts.outfile), { recursive: true });
    const buf = await withRetry(
      async () => {
        const res = await fetch(`${this.cfg.baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: this.cfg.model,
            input: text,
            voice: opts.voice ?? this.cfg.voice,
            response_format: "mp3",
            speed: opts.speed ?? this.cfg.speed,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 429;
          throw new ProviderError(`[tts:${this.name}] HTTP ${res.status}：${(await res.text()).slice(0, 200)}`, {
            retryable,
          });
        }
        return Buffer.from(await res.arrayBuffer());
      },
      {
        label: `tts:${this.name}`,
        retries: 3,
        retryOn: (err) => err instanceof ProviderError && err.retryable,
      },
    );
    if (buf.length < 512) throw new ProviderError(`[tts:${this.name}] 回傳音訊過短`);
    await writeFile(opts.outfile, buf);
    const durationSec = await probeDurationSec(opts.outfile);
    return { audioPath: opts.outfile, durationSec };
  }
}
