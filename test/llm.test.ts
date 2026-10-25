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
  contentText:
    "最近這幾天在 GitHub 有個專案『CleanYourTV』相當火熱！簡單說就是利用 AI 搭配這個開源的專案讓 ChatGPT、Claude 來對您家中的 Android TV 智慧電視解決卡頓、廣告的問題，整個操作過程不用電腦、不用 Root，只要手機安裝 APK 就可以搞定。而且還可以一鍵還原。今天就帶大家來實測這套工具。",
};

test("PassthroughLLM：剝站名後綴、全文句界切分口白、產生 intro/outro", async () => {
  const llm = new PassthroughLLM();
  const copies = await llm.generateSummaries([article]);
  assert.equal(copies.length, 1);
  assert.ok(!copies[0].shortHeadline.includes("挨踢部門"));
  assert.ok(copies[0].shortHeadline.length <= 16);
  // 口白取自全文（非 excerpt），句界切分（完整句 20–110 字）
  assert.ok(copies[0].narration.startsWith("最近這幾天"), `口白開頭异常：${copies[0].narration}`);
  assert.ok(/[。！？!?]$/u.test(copies[0].narration), `口白未在句界結尾：${copies[0].narration}`);
  assert.ok(copies[0].narration.length >= 20 && copies[0].narration.length <= 110);
  assert.ok(!copies[0].narration.includes("原文出處"));
  assert.ok(copies[0].tag.length > 0);
  const io = await llm.generateIntroOutro({ week: "2026-W43", dateLabel: "10/18 – 10/24", articleTitles: [article.title] });
  assert.ok(io.intro.includes("mobileai"));
  assert.ok(io.outro.includes("mobileai.net"));
});

test("makeHeadline / makeNarration：邊界行為", async () => {
  const { makeHeadline, makeNarration } = await import("../scripts/lib/llm/passthrough.ts");
  // 「主題：說明」型 → 取主題段
  assert.equal(makeHeadline("讓電視也能看紅果短劇！『紅果 TV』第三方 APK 下載與安裝教學"), "讓電視也能看紅果短劇");
  // 頓號也是自然斷點，不應出現「…平板…」硬切或刪節號
  assert.equal(makeHeadline("讓 Android 車機、平板變 Android Auto 導航螢幕！DiAuto 免 Root APK 下載安裝與連線教學"), "讓 Android 車機");
  // 沒有句讀時切在空白（英數詞邊界），不出現刪節號切半單字
  const h = makeHeadline("CleanYourTV Android TV 教學指南完整解析");
  assert.ok(!/[A-Za-z0-9]…$/u.test(h) && h.length <= 16, `短標切分不佳：${h}`);
  // 開頭重複「整段標題」時跳過（不是只跳 12 字）
  const dup = makeNarration({
    ...article,
    contentText: "受夠智慧電視滿版廣告又卡頓嗎？CleanYourTV 手機版 APK 實測教學。這篇文章要跟大家分享完整的安裝流程，其實整個過程相當簡單，只要三分鐘就能搞定一切！",
  });
  assert.ok(dup.startsWith("這篇文章"), `未跳過重複標題：${dup}`);
  assert.ok(/[。！？!?]$/u.test(dup), `切分位置不佳：${dup}`);
  // 頓號不作為口白切分點（列舉中斷句唸起來突兀）
  const enumText = "今天要介紹很多好物包括手機、平板、電視、車機、手錶等等，敬請期待下集內容！以上就是今天的介紹。";
  const enumNarration = makeNarration({ ...article, title: "好物清單", contentText: enumText, excerpt: "" });
  assert.ok(!/[、]$/u.test(enumNarration), `口白切在頓號：${enumNarration}`);
  assert.ok(enumNarration.length >= 40, `口白過短：${enumNarration}`);
  // 短文（< 40 字）原樣輸出
  const short = makeNarration({ ...article, contentText: "這是短文。", excerpt: "" });
  assert.equal(short, "這是短文。");
});

test("MockLLM：固定輸出且照順序", async () => {
  const llm = new MockLLM();
  const copies = await llm.generateSummaries([article, article]);
  assert.equal(copies.length, 2);
  assert.ok(copies[1].shortHeadline.includes("2"));
});

test("narrationLengthRule：旁白長度隨文章數自適應", async () => {
  const { narrationLengthRule } = await import("../scripts/lib/llm/prompts.ts");
  assert.match(narrationLengthRule(2), /90 到 130/);
  assert.match(narrationLengthRule(3), /90 到 130/);
  assert.match(narrationLengthRule(4), /70 到 100/);
  assert.match(narrationLengthRule(5), /70 到 100/);
  assert.match(narrationLengthRule(6), /50 到 75/);
  assert.match(narrationLengthRule(9), /50 到 75/);
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

test("OpenAICompatibleLLM：單一 model 保持 model 欄位", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(String(init.body)));
    return chatResponse('{"intro":"a","outro":"b"}');
  };
  try {
    const llm = new OpenAICompatibleLLM({
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      model: "google/gemma-4-31b-it:free",
      temperature: 0.4,
    });
    await llm.generateIntroOutro({ week: "2026-W43", dateLabel: "10/18 – 10/24", articleTitles: ["t"] });
    assert.equal(calls[0].model, "google/gemma-4-31b-it:free");
    assert.equal(calls[0].models, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAICompatibleLLM：逗號分隔 → OpenRouter models fallback 陣列", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(String(init.body)));
    return chatResponse('{"intro":"a","outro":"b"}');
  };
  try {
    const llm = new OpenAICompatibleLLM({
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      model: "nvidia/nemotron-3-super-120b-a12b:free, google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free",
      temperature: 0.4,
    });
    await llm.generateIntroOutro({ week: "2026-W43", dateLabel: "10/18 – 10/24", articleTitles: ["t"] });
    // 送出 models 陣列（依序 fallback），不送單一 model
    assert.deepEqual(calls[0].models, [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
    ]);
    assert.equal(calls[0].model, undefined);
    assert.equal(calls[0].response_format.type, "json_object");
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
