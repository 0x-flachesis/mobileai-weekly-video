import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../scripts/lib/config.ts";
import { isoWeekOf, resolveWeek } from "../scripts/lib/week.ts";

const BASE_ENV = {
  FEED_URL: undefined,
  LLM_PROVIDER: undefined,
  LLM_API_KEY: undefined,
  TTS_PROVIDER: undefined,
  MINIMAX_API_KEY: undefined,
  TTS_API_KEY: undefined,
};

function env(overrides = {}) {
  return { ...BASE_ENV, ...overrides };
}

test("config：無任何 key → passthrough + edge（零依賴模式）", () => {
  const cfg = loadConfig(env());
  assert.equal(cfg.llm.provider, "passthrough");
  assert.equal(cfg.tts.provider, "edge");
  assert.equal(cfg.tts.voice, "zh-TW-HsiaoChenNeural");
});

test("config：MINIMAX_API_KEY → 自動選 minimax TTS", () => {
  const cfg = loadConfig(env({ MINIMAX_API_KEY: "jwt-token" }));
  assert.equal(cfg.tts.provider, "minimax");
  assert.equal(cfg.tts.baseUrl, "https://api.minimax.cn");
  assert.equal(cfg.tts.model, "speech-2.8-hd");
});

test("config：MINIMAX_BASE_URL 可換國際站", () => {
  const cfg = loadConfig(env({ MINIMAX_API_KEY: "k", MINIMAX_BASE_URL: "https://api.minimaxi.com/" }));
  assert.equal(cfg.tts.baseUrl, "https://api.minimaxi.com");
});

test("config：LLM_API_KEY → 自動選 openai-compatible", () => {
  const cfg = loadConfig(env({ LLM_API_KEY: "sk-test" }));
  assert.equal(cfg.llm.provider, "openai-compatible");
  assert.equal(cfg.llm.baseUrl, "https://api.openai.com/v1");
});

test("config：GLM 端點組合", () => {
  const cfg = loadConfig(
    env({
      LLM_API_KEY: "glm-key",
      LLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/",
      LLM_MODEL: "glm-4-flash",
    }),
  );
  assert.equal(cfg.llm.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(cfg.llm.model, "glm-4-flash");
});

test("config：明確 mock", () => {
  const cfg = loadConfig(env({ LLM_PROVIDER: "mock", TTS_PROVIDER: "mock" }));
  assert.equal(cfg.llm.provider, "mock");
  assert.equal(cfg.tts.provider, "mock");
});

test("config：指定 openai-compatible 但缺 key → 丟錯", () => {
  assert.throws(() => loadConfig(env({ LLM_PROVIDER: "openai-compatible" })), /LLM_API_KEY/);
  assert.throws(() => loadConfig(env({ TTS_PROVIDER: "minimax" })), /MINIMAX_API_KEY/);
});

test("isoWeekOf：已知日期", () => {
  assert.deepEqual(isoWeekOf(new Date("2026-01-01T12:00:00+08:00")), { year: 2026, week: 1 });
  // 2026 為 53 週年（1/1 週四）：年底跨年週多數天屬 2026 → W53
  assert.deepEqual(isoWeekOf(new Date("2026-12-31T12:00:00+08:00")), { year: 2026, week: 53 });
  assert.deepEqual(isoWeekOf(new Date("2027-01-02T12:00:00+08:00")), { year: 2026, week: 53 });
  assert.deepEqual(isoWeekOf(new Date("2027-01-04T12:00:00+08:00")), { year: 2027, week: 1 });
  assert.deepEqual(isoWeekOf(new Date("2026-10-25T09:00:00+08:00")), { year: 2026, week: 43 });
});

test("resolveWeek：週次與路徑", () => {
  const w = resolveWeek(new Date("2026-10-25T09:00:00+08:00"), { lookbackDays: 7 });
  assert.equal(w.week, "2026-W43");
  assert.equal(w.weekDir, "data/issues/2026-W43");
  assert.equal(w.assetsDir, "public/assets/2026-W43");
  assert.equal(w.relAssetsDir, "assets/2026-W43");
  assert.equal(w.dateLabel, "10/18 – 10/25");
  // 台北 09:00 執行 → 視窗恰好 7 天
  const span = (new Date(w.windowEndISO).getTime() - new Date(w.windowStartISO).getTime()) / 1000;
  assert.equal(Math.round(span / 86400), 7);
});
