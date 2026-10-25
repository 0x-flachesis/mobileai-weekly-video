import assert from "node:assert/strict";
import { test } from "node:test";
import { hashString, mulberry32, parseJsonLoose, truncateCJK, withRetry } from "../scripts/lib/util.ts";

test("parseJsonLoose：剝掉 code fence 與前後雜訊", () => {
  const obj = parseJsonLoose('好的，以下是結果：\n```json\n{"a":1}\n```\n以上');
  assert.deepEqual(obj, { a: 1 });
  const arr = parseJsonLoose('前言 {"x":2} 後記 [1,2]');
  assert.deepEqual(arr, { x: 2 }); // 取第一個 { … } 區塊
  const rawArr = parseJsonLoose("[1,2,3]");
  assert.deepEqual(rawArr, [1, 2, 3]);
});

test("parseJsonLoose：無 JSON 時丟錯", () => {
  assert.throws(() => parseJsonLoose("完全沒有 json"));
});

test("truncateCJK：全形裁切加刪節號", () => {
  assert.equal(truncateCJK("一二三四五", 5), "一二三四五");
  assert.equal(truncateCJK("一二三四五六七", 5), "一二三四…");
});

test("hashString / mulberry32：決定性", () => {
  assert.equal(hashString("2026-W43:mobileai-weekly"), hashString("2026-W43:mobileai-weekly"));
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(r1(), r2());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test("withRetry：重試後成功", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("暫時失敗");
      return "ok";
    },
    { retries: 3, baseDelayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry：retryOn=false 不重試", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error("不重試的錯");
      },
      { retries: 3, baseDelayMs: 1, retryOn: () => false },
    ),
  );
  assert.equal(calls, 1);
});

test("clipNarration：超長旁白切在句尾標點，不切在詞中間", async () => {
  const { clipNarration } = await import("../scripts/lib/util.ts");
  const long = "第一句完整敘述。".repeat(40); // 280 字，全句號
  const clipped = clipNarration(long, 240);
  assert.ok(clipped.length <= 240, `超過上限：${clipped.length}`);
  assert.ok(/[。！？；…]$/u.test(clipped), `未在句界結尾：${clipped.slice(-10)}`);
  assert.ok(!clipped.endsWith("…"), "不應用 truncateCJK 的刪節號收尾");
  // 上限內不動原文
  assert.equal(clipNarration("短旁白。", 240), "短旁白。");
  // 完全沒有句尾標點才硬切
  const noPunct = "字".repeat(300);
  assert.equal(clipNarration(noPunct, 240).length, 240);
});
