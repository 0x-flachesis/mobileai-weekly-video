import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { MinimaxTTS } from "../scripts/lib/tts/minimax.ts";
import { MockTTS } from "../scripts/lib/tts/mock.ts";
import { ProviderError } from "../scripts/lib/util.ts";

const pexec = promisify(execFile);

async function makeTinyMp3(): Promise<{ path: string; hex: string; durationSec: number }> {
  const dir = await mkdtemp(join(tmpdir(), "mawv-"));
  const path = join(dir, "tiny.mp3");
  await pexec("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=32000:cl=mono", "-t", "1.2", "-codec:a", "libmp3lame", "-q:a", "9", path]);
  const buf = await readFile(path);
  return { path, hex: buf.toString("hex"), durationSec: 1.2 };
}

function makeProvider() {
  return new MinimaxTTS({
    provider: "minimax",
    baseUrl: "https://api.minimax.cn",
    apiKey: "test-key",
    model: "speech-2.8-hd",
    voice: "male-qn-qingse",
    speed: 1,
    pitch: 0,
  });
}

test("MinimaxTTS：hex 音訊寫檔 + 時長交叉檢查", async () => {
  const tiny = await makeTinyMp3();
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody = null;
  let capturedAuth = "";
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init.body));
    capturedAuth = String(init.headers.Authorization);
    return new Response(
      JSON.stringify({
        base_resp: { status_code: 0, status_msg: "success" },
        data: { audio: tiny.hex },
        extra_info: { audio_length: 1200 }, // ms
      }),
      { status: 200 },
    );
  };
  try {
    const out = join(tiny.path, "..", "out.mp3");
    const result = await makeProvider().synthesize("測試旁白", { outfile: out });
    assert.equal(capturedUrl, "https://api.minimax.cn/v1/t2a_v2");
    assert.equal(capturedAuth, "Bearer test-key");
    // 請求體形狀（依官方 t2a_v2 規格）
    assert.equal(capturedBody.model, "speech-2.8-hd");
    assert.equal(capturedBody.stream, false);
    assert.equal(capturedBody.voice_setting.voice_id, "male-qn-qingse");
    assert.equal(capturedBody.audio_setting.format, "mp3");
    assert.equal(capturedBody.audio_setting.sample_rate, 32000);
    assert.equal(capturedBody.audio_setting.bitrate, 128000);
    assert.equal(capturedBody.audio_setting.channel, 1);
    assert.equal(capturedBody.language_boost, "Chinese");
    assert.equal(capturedBody.output_format, "hex");
    // 結果
    assert.ok(Math.abs(result.durationSec - 1.2) < 0.1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MinimaxTTS：base_resp 非 0 → ProviderError 帶 code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ base_resp: { status_code: 1004, status_msg: "invalid auth" } }),
      { status: 200 },
    );
  try {
    const dir = await mkdtemp(join(tmpdir(), "mawv-"));
    await assert.rejects(
      makeProvider().synthesize("x", { outfile: join(dir, "a.mp3") }),
      (err) => err instanceof ProviderError && err.code === 1004 && /invalid auth/.test(err.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MinimaxTTS：限流 1002 → 重試後成功", async () => {
  const tiny = await makeTinyMp3();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ base_resp: { status_code: 1002, status_msg: "rate limited" } }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: tiny.hex }, extra_info: { audio_length: 1200 } }),
      { status: 200 },
    );
  };
  try {
    const dir = await mkdtemp(join(tmpdir(), "mawv-"));
    const result = await makeProvider().synthesize("重試測試", { outfile: join(dir, "b.mp3") });
    assert.equal(calls, 2);
    assert.ok(result.durationSec > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MockTTS：產生可探測時長的靜音 mp3", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mawv-"));
  const tts = new MockTTS({ provider: "mock", charsPerSecond: 4.2 });
  const out = join(dir, "m.mp3");
  const result = await tts.synthesize("這一段測試文字共有十四個字", { outfile: out });
  assert.ok(result.durationSec >= 3 && result.durationSec <= 6, `時長 ${result.durationSec}`);
});
