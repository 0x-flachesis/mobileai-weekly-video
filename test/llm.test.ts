import assert from "node:assert/strict";
import { test } from "node:test";
import { PassthroughLLM } from "../scripts/lib/llm/passthrough.ts";
import { MockLLM } from "../scripts/lib/llm/mock.ts";
import { OpenAICompatibleLLM } from "../scripts/lib/llm/openai-compatible.ts";
import type { ArticleInput } from "../scripts/lib/llm/types.ts";

const article: ArticleInput = {
  guid: "https://mobileai.net/2026/10/24/x/",
  title: "受夠智慧電視滿版廣告又卡頓嗎？CleanYourTV 手機版 APK 實測教學",
  link: "https://mobileai.net/2026/10/24/x/",
  publishedISO: "2026-10-24T10:36:06Z",
  categories: ["軟體・APP", "Android TV"],
  excerpt: "《原文出處：…》這篇介紹一個熱門 GitHub 專案，用 AI 加上開源程式碼就能去除電視廣告。",
  contentText: "內文文字……",
};

test("PassthroughLLM：剝站名後綴、清 excerpt、產生 intro/outro", async () => {
  const llm = new PassthroughLLM();
  const copies = await llm.generateSummaries([article]);
  assert.equal(copies.length, 1);
  assert.ok(!copies[0].shortHeadline.includes("挨踢部門"));
  assert.ok(copies[0].shortHeadline.length <= 16);
  assert.ok(!copies[0].narration.includes("原文出處"));
  assert.ok(copies[0].tag.length > 0);
  const io = await llm.generateIntroOutro({ week: "2026-W43", dateLabel: "10/18 – 10/24", articleTitles: [article.title] });
  assert.ok(io.intro.includes("mobileai"));
  assert.ok(io.outro.includes("mobileai.net"));
});

test("MockLLM：固定輸出且照順序", async () => {
  const llm = new MockLLM();
  const copies = await llm.generateSummaries([article, article]);
  assert.equal(copies.length, 2);
  assert.ok(copies[1].shortHeadline.includes("2"));
});

test("OpenAICompatibleLLM：請求形狀 + fence 解析 + 修正重試", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    if (calls.length === 1) {
      // 第一次回非 JSON → 觸發修正重試
      return chatResponse("抱歉，我需要更多資訊才能回答。");
    }
    return chatResponse('{"articles":[{"index":0,"shortHeadline":"乾淨看片神器","narration":"這款工具一鍵清除電視廣告。","tag":"APP 教學"}]}');
  };
  try {
    const llm = new OpenAICompatibleLLM({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "test-model",
      temperature: 0.4,
    });
    const copies = await llm.generateSummaries([article]);
    assert.equal(copies.length, 1);
    assert.equal(copies[0].shortHeadline, "乾淨看片神器");
    // 檢查請求形狀
    assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
    assert.equal(calls[1].body.model, "test-model");
    assert.equal(calls[1].body.response_format.type, "json_object");
    assert.ok(calls[1].body.messages.some((m) => m.role === "system"));
    // 修正輪會把 assistant 回覆帶回去
    assert.equal(calls[1].body.messages[2].role, "assistant");
    assert.equal(calls[1].body.messages[3].role, "user");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAICompatibleLLM：數量不符 → 丟 ProviderError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => chatResponse('{"articles":[]}');
  try {
    const llm = new OpenAICompatibleLLM({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      model: "m",
      temperature: 0.4,
    });
    await assert.rejects(llm.generateSummaries([article]), /數量不符/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** 包成 OpenAI chat completion 信封。 */
function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
