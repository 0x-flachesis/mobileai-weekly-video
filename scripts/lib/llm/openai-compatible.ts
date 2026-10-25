import type { LLMOpenAICompatConfig } from "../config.ts";
import type {
  ArticleCopy,
  ArticleInput,
  IntroOutro,
  IntroOutroInput,
  LLMProvider,
} from "./types.ts";
import { INTRO_OUTRO_SYSTEM, SUMMARY_SYSTEM, introOutroUserPrompt, summaryUserPrompt } from "./prompts.ts";
import { ProviderError, clampNumber, errMsg, parseJsonLoose, truncateCJK, withRetry } from "../util.ts";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 自動挑選時排除的模型（審核/嵌入器不是聊天模型）。 */
const AUTO_BLOCKLIST = /content-safety|guard|embed|reranker/i;
/** 偏好 instruction-tuned 聊天模型（排序加權）。 */
const INSTRUCT_HINT = /(-it$|-it:|-instruct|chat|qwen|gemma|nemotron|deepseek|llama)/i;
const AUTO_MODEL_COUNT = 4;

interface OpenRouterModel {
  id: string;
  context_length?: number;
}

/** 抓 OpenRouter 免費模型清單並排序（instruction-tuned 優先、context 長者優先）。 */
export async function fetchOpenRouterFreeModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ProviderError(`OpenRouter /models HTTP ${res.status}`, { retryable: true });
  const json = (await res.json()) as { data?: OpenRouterModel[] };
  const free = (json.data ?? []).filter((m) => m.id.endsWith(":free") && !AUTO_BLOCKLIST.test(m.id));
  free.sort((a, b) => {
    const score = (m: OpenRouterModel) =>
      (INSTRUCT_HINT.test(m.id) ? 1_000_000 : 0) + (m.context_length ?? 0);
    return score(b) - score(a);
  });
  const picked = free.slice(0, AUTO_MODEL_COUNT).map((m) => m.id);
  if (!picked.length) throw new ProviderError("OpenRouter 免費模型清單為空");
  return picked;
}

/** 自動模式抓不到清單時的內建備援（手動快照，可能過期但堪用）。 */
export const OPENROUTER_FREE_FALLBACK = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "liquid/lfm-2.5-2.6b:free",
];

/** OpenAI 相容 chat completions（GLM / OpenAI / Ollama / OpenRouter …）。 */
export class OpenAICompatibleLLM implements LLMProvider {
  readonly name = "openai-compatible";
  cfg: LLMOpenAICompatConfig;
  private resolvedModels: string[] | null = null;

  constructor(cfg: LLMOpenAICompatConfig) {
    this.cfg = cfg;
  }

  private isOpenRouter(): boolean {
    return /openrouter\.ai/i.test(this.cfg.baseUrl);
  }

  private isAutoFree(): boolean {
    return this.isOpenRouter() && (!this.cfg.model || this.cfg.model.trim().toLowerCase() === "auto:free");
  }

  /** 解析最終模型清單：auto:free → 動態抓免費清單（失敗用內建備援）；其餘按逗號切分。 */
  private async resolveModels(): Promise<string[]> {
    if (this.resolvedModels) return this.resolvedModels;
    let models: string[];
    if (this.isAutoFree()) {
      try {
        models = await fetchOpenRouterFreeModels(this.cfg.baseUrl, this.cfg.apiKey);
        console.log(`[llm:${this.name}] OpenRouter 自動挑選免費模型：${models.join(", ")}`);
      } catch (err) {
        console.warn(`[llm:${this.name}] 無法取得免費模型清單（${errMsg(err)}），使用內建備援清單`);
        models = OPENROUTER_FREE_FALLBACK;
      }
    } else {
      models = this.cfg.model
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
    }
    this.resolvedModels = models;
    return models;
  }

  /**
   * 多模型時改送 `models` 陣列（OpenRouter 依序 fallback，
   * 例如免費模型限流時自動切下一個）；單模型維持 `model` 欄位。
   */
  private async requestBody(messages: ChatMessage[]): Promise<Record<string, unknown>> {
    const models = await this.resolveModels();
    const modelSpec = models.length > 1 ? { models } : { model: models[0] ?? this.cfg.model };
    return {
      ...modelSpec,
      temperature: this.cfg.temperature,
      messages,
      response_format: { type: "json_object" },
    };
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.cfg.baseUrl}/chat/completions`;
    return withRetry(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body: JSON.stringify(await this.requestBody(messages)),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
          throw new ProviderError(
            `LLM ${this.cfg.model} HTTP ${res.status}：${body.slice(0, 200)}`,
            { retryable },
          );
        }
        const json = (await res.json()) as {
          model?: string;
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new ProviderError("LLM 回應缺少 choices[0].message.content", { retryable: true });
        // OpenRouter models 陣列路由時，記錄實際使用的模型
        if (json.model && json.model !== this.cfg.model) {
          console.log(`[llm:${this.name}] 路由到模型 ${json.model}`);
        }
        return content;
      },
      {
        label: `llm:${this.name}`,
        retries: 3,
        retryOn: (err) =>
          (err instanceof ProviderError && err.retryable) || err instanceof TypeError,
      },
    );
  }

  async generateSummaries(articles: ArticleInput[]): Promise<ArticleCopy[]> {
    if (articles.length === 0) return [];
    const messages: ChatMessage[] = [
      { role: "system", content: SUMMARY_SYSTEM },
      { role: "user", content: summaryUserPrompt(articles) },
    ];
    let raw: string;
    try {
      raw = await this.chat(messages);
    } catch (err) {
      throw new Error(`[llm:${this.name}] generateSummaries 失敗：${errMsg(err)}`);
    }
    let parsed: { articles?: { index?: number; shortHeadline?: string; narration?: string; tag?: string }[] };
    try {
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch {
      // 解析失敗：把錯誤回饋給模型重試一次
      raw = await this.chat([
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: "上面的輸出不是合法 JSON。請重新輸出完整 JSON，格式：{\"articles\":[{\"index\":0,\"shortHeadline\":\"…\",\"narration\":\"…\",\"tag\":\"…\"}]}",
        },
      ]);
      try {
        parsed = parseJsonLoose(raw) as typeof parsed;
      } catch (err) {
        throw new Error(`[llm:${this.name}] 摘要 JSON 解析失敗：${errMsg(err)}`);
      }
    }
    const list = parsed.articles;
    if (!Array.isArray(list) || list.length !== articles.length) {
      throw new ProviderError(
        `[llm:${this.name}] 摘要數量不符（預期 ${articles.length}，得到 ${Array.isArray(list) ? list.length : "非陣列"}）`,
      );
    }
    const byIndex = new Map<number, (typeof list)[number]>();
    for (const item of list) byIndex.set(item.index ?? -1, item);
    return articles.map((_, i) => {
      const item = byIndex.get(i);
      if (!item || !item.shortHeadline || !item.narration) {
        throw new ProviderError(`[llm:${this.name}] index ${i} 缺少 shortHeadline/narration`);
      }
      return {
        shortHeadline: truncateCJK(item.shortHeadline.trim(), 16),
        narration: item.narration.trim().slice(0, 150),
        tag: truncateCJK((item.tag ?? "科技").trim(), 8),
      };
    });
  }

  async generateIntroOutro(input: IntroOutroInput): Promise<IntroOutro> {
    const raw = await this.chat([
      { role: "system", content: INTRO_OUTRO_SYSTEM },
      { role: "user", content: introOutroUserPrompt(input) },
    ]);
    let parsed: { intro?: string; outro?: string };
    try {
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch (err) {
      throw new Error(`[llm:${this.name}] intro/outro JSON 解析失敗：${errMsg(err)}`);
    }
    if (!parsed.intro || !parsed.outro) {
      throw new ProviderError(`[llm:${this.name}] intro/outro 缺欄位`);
    }
    return {
      intro: parsed.intro.trim().slice(0, 60),
      outro: parsed.outro.trim().slice(0, 80),
    };
  }
}
