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

/** OpenAI 相容 chat completions（GLM / OpenAI / Ollama / OpenRouter …）。 */
export class OpenAICompatibleLLM implements LLMProvider {
  readonly name = "openai-compatible";
  cfg: LLMOpenAICompatConfig;

  constructor(cfg: LLMOpenAICompatConfig) {
    this.cfg = cfg;
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
          body: JSON.stringify({
            model: this.cfg.model,
            temperature: this.cfg.temperature,
            messages,
            response_format: { type: "json_object" },
          }),
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
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new ProviderError("LLM 回應缺少 choices[0].message.content", { retryable: true });
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
