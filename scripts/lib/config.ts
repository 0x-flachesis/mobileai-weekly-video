import "dotenv/config";

/**
 * 統一環境設定。所有 provider 選擇以環境變數為準，未指定時自動探測：
 * - LLM：有 LLM_API_KEY → openai-compatible，否則 passthrough（零 key）
 * - TTS：有 MINIMAX_API_KEY → minimax；有 TTS_API_KEY → openai-compatible；否則 edge（零 key）
 */

export type LLMProviderName = "openai-compatible" | "passthrough" | "mock";
export type TTSProviderName = "edge" | "minimax" | "openai-compatible" | "mock";

export interface LLMOpenAICompatConfig {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface LLMPassthroughConfig {
  provider: "passthrough";
}

export interface LLMMockConfig {
  provider: "mock";
}

export type LLMConfig = LLMOpenAICompatConfig | LLMPassthroughConfig | LLMMockConfig;

export interface TTSEdgeConfig {
  provider: "edge";
  voice: string;
}

export interface TTSMinimaxConfig {
  provider: "minimax";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
  pitch: number;
}

export interface TTSOpenAICompatConfig {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
}

export interface TTSMockConfig {
  provider: "mock";
  charsPerSecond: number;
}

export type TTSConfig = TTSEdgeConfig | TTSMinimaxConfig | TTSOpenAICompatConfig | TTSMockConfig;

export interface AppConfig {
  feedUrl: string;
  lookbackDays: number;
  dataDir: string;
  outputDir: string;
  publicAssetsDir: string;
  userAgent: string;
  llm: LLMConfig;
  tts: TTSConfig;
}

type Env = Record<string, string | undefined>;

/** URL 環境變數清理：去空白與尾斜線。 */
function cleanUrl(v: string | undefined, fallback: string): string {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  return s || fallback;
}

function resolveLLM(env: Env): LLMConfig {
  const explicit = env.LLM_PROVIDER?.trim();
  if (explicit === "mock") return { provider: "mock" };
  if (explicit === "passthrough") return { provider: "passthrough" };
  const apiKey = (env.LLM_API_KEY ?? "").trim();
  if (explicit === "openai-compatible" && !apiKey) {
    throw new Error("LLM_PROVIDER=openai-compatible 需要 LLM_API_KEY");
  }
  if (explicit && explicit !== "openai-compatible") {
    throw new Error(`未支援的 LLM_PROVIDER：${explicit}`);
  }
  if (!apiKey) return { provider: "passthrough" };
  const baseUrl = cleanUrl(env.LLM_BASE_URL, "https://api.openai.com/v1");
  const isOpenRouter = /openrouter\.ai/i.test(baseUrl);
  return {
    provider: "openai-compatible",
    baseUrl,
    apiKey,
    // OpenRouter 未指定模型時 → auto:free（執行期自動抓免費模型清單組 fallback）
    model: env.LLM_MODEL ?? (isOpenRouter ? "auto:free" : "gpt-4o-mini"),
    temperature: Number.parseFloat(env.LLM_TEMPERATURE ?? "0.4"),
  };
}

function resolveTTS(env: Env): TTSConfig {
  const explicit = env.TTS_PROVIDER;
  if (explicit === "mock") {
    return { provider: "mock", charsPerSecond: Number.parseFloat(env.MOCK_TTS_CPS ?? "4.2") };
  }
  if (explicit === "edge") return { provider: "edge", voice: env.EDGE_TTS_VOICE ?? "zh-TW-HsiaoChenNeural" };
  if (explicit === "minimax") {
    if (!env.MINIMAX_API_KEY) throw new Error("TTS_PROVIDER=minimax 需要 MINIMAX_API_KEY");
    return buildMinimax(env);
  }
  if (explicit === "openai-compatible") {
    if (!env.TTS_API_KEY) throw new Error("TTS_PROVIDER=openai-compatible 需要 TTS_API_KEY");
    return buildOpenAITTS(env);
  }
  if (explicit) throw new Error(`未支援的 TTS_PROVIDER：${explicit}`);
  // 自動探測
  if (env.MINIMAX_API_KEY) return buildMinimax(env);
  if (env.TTS_API_KEY) return buildOpenAITTS(env);
  return { provider: "edge", voice: env.EDGE_TTS_VOICE ?? "zh-TW-HsiaoChenNeural" };
}

function buildMinimax(env: Env): TTSMinimaxConfig {
  return {
    provider: "minimax",
    baseUrl: cleanUrl(env.MINIMAX_BASE_URL, "https://api.minimax.cn"),
    apiKey: (env.MINIMAX_API_KEY ?? "").trim(),
    model: env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd",
    voice: env.MINIMAX_TTS_VOICE ?? "male-qn-qingse",
    speed: Number.parseFloat(env.MINIMAX_TTS_SPEED ?? "1.0"),
    pitch: Number.parseFloat(env.MINIMAX_TTS_PITCH ?? "0"),
  };
}

function buildOpenAITTS(env: Env): TTSOpenAICompatConfig {
  return {
    provider: "openai-compatible",
    baseUrl: cleanUrl(env.TTS_BASE_URL, "https://api.openai.com/v1"),
    apiKey: (env.TTS_API_KEY ?? "").trim(),
    model: env.TTS_MODEL ?? "gpt-4o-mini-tts",
    voice: env.TTS_VOICE ?? "alloy",
    speed: Number.parseFloat(env.TTS_SPEED ?? "1.0"),
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const lookback = Number.parseInt(env.LOOKBACK_DAYS ?? "7", 10);
  return {
    feedUrl: env.FEED_URL ?? "https://mobileai.net/feed/",
    lookbackDays: Number.isFinite(lookback) && lookback > 0 ? lookback : 7,
    dataDir: env.DATA_DIR ?? "data",
    outputDir: env.OUTPUT_DIR ?? "output",
    publicAssetsDir: env.PUBLIC_ASSETS_DIR ?? "public/assets",
    userAgent:
      env.USER_AGENT ??
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    llm: resolveLLM(env),
    tts: resolveTTS(env),
  };
}
