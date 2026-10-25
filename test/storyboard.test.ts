import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCaptions,
  kenburnsFor,
  makeBeatGrid,
  snapError,
  snapToBeat,
  wrapHeadline,
} from "../scripts/lib/storyboard.ts";

test("snapToBeat：吸附後誤差不超過半拍", () => {
  const grid = makeBeatGrid(110, 30); // 16.36 frames/beat
  for (let f = 0; f < 2000; f += 7) {
    const snapped = snapToBeat(f, grid);
    assert.ok(snappedError(f, snapped), `frame ${f} → ${snapped} 誤差過大`);
  }
  function snappedError(f: number, s: number) {
    return Math.abs(s - f) <= Math.ceil(grid.framesPerBeat / 2);
  }
});

test("snapToBeat：110BPM@30fps 的節拍間隔正確", () => {
  const grid = makeBeatGrid(110, 30);
  assert.equal(snapToBeat(0, grid), 0);
  assert.equal(snapToBeat(17, grid), 16); // 最近的 beat = 1
  assert.equal(snapToBeat(24, grid), 16); // 24 距 beat1(16f) 8f、距 beat2(33f) 9f → 吸附 beat1
  assert.ok(snapError(24, grid) <= Math.ceil(grid.framesPerBeat / 2));
});

test("buildCaptions：切分、比例分配、遞增不重疊", () => {
  const text = "這是第一句。這是第二句，比較長一點！最後一句？";
  const cues = buildCaptions(text, 150);
  assert.ok(cues.length >= 3);
  let prevEnd = 0;
  for (const c of cues) {
    assert.ok(c.from >= prevEnd, "cue 起點應遞增");
    assert.ok(c.duration > 0);
    assert.ok(c.text.length <= 16);
    prevEnd = c.from + c.duration;
  }
  assert.ok(prevEnd <= 150, "字幕總長不超過語音時長");
  // cue 尾端標點已去除供顯示
  assert.equal(
    cues.map((c) => c.text).join("").replace(/ /g, ""),
    text.replace(/ /g, "").replace(/[。！？!?，,、；;：:]+$/gu, "").replace(/[。！？!?，,、；;：:]/gu, ""),
  );
});

test("buildCaptions：超長句自動包行", () => {
  const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
  const cues = buildCaptions(long, 300, 10);
  assert.ok(cues.every((c) => c.text.length <= 10));
});

test("wrapHeadline：英數單字不切半、行寬受限、上限 3 行", () => {
  const text = "讓 Android 車機平板變 Android Auto 導航螢幕";
  const latinWords = text.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const lines = wrapHeadline(text, 7);
  for (const line of lines) {
    assert.ok(line.length <= 7, `行「${line}」（${line.length} 字）超過 7`);
    for (const run of line.match(/[A-Za-z][A-Za-z\-']*/g) ?? []) {
      assert.ok(latinWords.includes(run), `單字「${run}」被切半（行：「${line}」）`);
    }
  }
  // 上限 3 行
  assert.ok(wrapHeadline("一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五", 5).length <= 3);
  // 純中文逐字打包
  assert.deepEqual(wrapHeadline("一二三四五六七", 3), ["一二三", "四五六", "七"]);
});

test("kenburnsFor：同 seed 結果一致、scale 在合理範圍", () => {
  const a = kenburnsFor(123);
  const b = kenburnsFor(123);
  assert.deepEqual(a, b);
  for (const s of [a.fromScale, a.toScale]) {
    assert.ok(s >= 1.03 && s <= 1.2, `scale ${s} 超界`);
  }
  const c = kenburnsFor(456);
  assert.ok(
    c.fromScale !== a.fromScale || c.toX !== a.toX,
    "不同 seed 應產生不同運鏡",
  );
});
