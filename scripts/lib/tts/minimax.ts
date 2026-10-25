import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { probeDurationSec } from "../audio.ts";
import type { TTSMinimaxConfig } from "../config.ts";
import type { SynthOptions, SynthResult, TTSProvider } from "./types.ts";
import { ProviderError, withRetry } from "../util.ts";

interface MinimaxResponse {
  base_resp?: { status_code?: number; status_msg?: string };
  data?: { audio?: string };
  extra_info?: { audio_length?: number };
  trace_id?: string;
}

/** 限流 / 逾時類錯誤碼，可重試。 */
const RETRYABLE_CODES = new Set([1001, 1002, 1039]);

let tradToCnConverter: ((s: string) => string) | null = null;

/**
 * 繁體（台灣，含詞彙）→ 簡體轉換。MiniMax 語音以簡體詞彙為準
 * （軟體→软件、螢幕→屏幕），配大陸語音時讀音才正確。
 */
async function toSimplifiedChinese(text: string): Promise<string> {
  if (!tradToCnConverter) {
    const mod = (await import("opencc-js")) as unknown as Record<string, unknown>;
    const OpenCC = (mod.Converter ?? (mod.default as Record<string, unknown> | undefined)?.Converter) as
      | ((opts: { from: string; to: string }) => (s: string) => string)
      | undefined;
    if (!OpenCC) throw new ProviderError("[tts:minimax] 無法載入 opencc-js 模組");
    tradToCnConverter = OpenCC({ from: "twp", to: "cn" });
  }
  return tradToCnConverter(text);
}

/** MiniMax T2A v2（POST /v1/t2a_v2，hex 音訊回傳）。 */
export class MinimaxTTS implements TTSProvider {
  readonly name = "minimax";
  cfg: TTSMinimaxConfig;

  constructor(cfg: TTSMinimaxConfig) {
    this.cfg = cfg;
  }

  async synthesize(text: string, opts: SynthOptions): Promise<SynthResult> {
    await mkdir(dirname(opts.outfile), { recursive: true });
    const url = `${this.cfg.baseUrl}/v1/t2a_v2`;
    const speed = opts.speed ?? this.cfg.speed;
    const ttsText = await toSimplifiedChinese(text);

    const json = await withRetry(
      async () => {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.cfg.apiKey}`,
            },
            body: JSON.stringify({
              model: this.cfg.model,
              text: ttsText,
              stream: false,
              voice_setting: {
                voice_id: opts.voice ?? this.cfg.voice,
                speed,
                pitch: this.cfg.pitch,
                vol: 5,
              },
              audio_setting: {
                format: "mp3",
                sample_rate: 32000,
                bitrate: 128000,
                channel: 1,
              },
              language_boost: "Chinese",
              output_format: "hex",
            }),
            signal: AbortSignal.timeout(120_000),
          });
        } catch (err) {
          throw new ProviderError(`[tts:minimax] 請求失敗：${String(err)}`, { retryable: true });
        }
        if (res.status >= 500 || res.status === 429) {
          throw new ProviderError(`[tts:minimax] HTTP ${res.status}`, { retryable: true });
        }
        if (!res.ok) {
          throw new ProviderError(`[tts:minimax] HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
        }
        const body = (await res.json()) as MinimaxResponse;
        const status = body.base_resp?.status_code ?? -1;
        if (status !== 0) {
          throw new ProviderError(
            `[tts:minimax] t2a_v2 錯誤 ${status}：${body.base_resp?.status_msg ?? "未知"}（trace ${body.trace_id ?? "-"}）`,
            { code: status, retryable: RETRYABLE_CODES.has(status) },
          );
        }
        return body;
      },
      {
        label: "tts:minimax",
        retries: 3,
        retryOn: (err) => err instanceof ProviderError && err.retryable,
      },
    );

    const hex = json.data?.audio;
    if (!hex || hex.length === 0 || hex.length % 2 !== 0) {
      throw new ProviderError("[tts:minimax] 回應缺少合法的 data.audio hex 字串");
    }
    const buf = Buffer.from(hex, "hex");
    if (buf.length < 512) throw new ProviderError("[tts:minimax] 音訊資料過短，疑似合成失敗");
    await writeFile(opts.outfile, buf);

    const durationSec = await probeDurationSec(opts.outfile);
    // extra_info.audio_length（毫秒）交叉檢查，誤差 >5% 視為異常
    const reportedMs = json.extra_info?.audio_length;
    if (typeof reportedMs === "number" && reportedMs > 0) {
      const reportedSec = reportedMs / 1000;
      if (Math.abs(reportedSec - durationSec) / reportedSec > 0.05) {
        throw new ProviderError(
          `[tts:minimax] 音檔時長 ${durationSec.toFixed(2)}s 與回報 ${reportedSec.toFixed(2)}s 差異超過 5%`,
        );
      }
    }
    return { audioPath: opts.outfile, durationSec };
  }
}
