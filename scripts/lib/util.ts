/**
 * 共用工具：確定性偽隨機、重試、鬆散 JSON 解析、錯誤型別。
 * 注意：本檔由 Node 原生 type-stripping 執行，僅可使用可抹除語法
 * （禁止 enum / namespace / constructor parameter properties）。
 */

export class ProviderError extends Error {
  code?: number;
  retryable: boolean;
  constructor(message: string, opts?: { code?: number; retryable?: boolean }) {
    super(message);
    this.name = "ProviderError";
    this.code = opts?.code;
    this.retryable = opts?.retryable ?? false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
  retryOn?: (err: unknown) => boolean;
}

/** 指數退避重試；預設重試 2 次（共 3 次嘗試）。 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts.retryOn ? opts.retryOn(err) : true;
      if (attempt === retries || !retryable) break;
      const delay = baseDelayMs * 2 ** attempt;
      if (opts.label) {
        console.warn(`[retry] ${opts.label} 第 ${attempt + 1} 次失敗，${delay}ms 後重試：${errMsg(err)}`);
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** FNV-1a 字串雜湊 → 32-bit 正整數 seed。 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 確定性 PRNG（Remotion 渲染不可使用 Math.random）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 解析 LLM 回傳的 JSON：剝掉 code fence、抓第一個 { 或 [ 到最後一個 } 或 ]。 */
export function parseJsonLoose(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const start =
    firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;
  if (start === -1) throw new ProviderError(`回應中找不到 JSON：${s.slice(0, 120)}`);
  const openCh = s[start];
  const closeCh = openCh === "{" ? "}" : "]";
  const end = s.lastIndexOf(closeCh);
  if (end <= start) throw new ProviderError(`JSON 不完整：${s.slice(0, 120)}`);
  return JSON.parse(s.slice(start, end + 1));
}

export function clampNumber(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 把字串裁切到 maxLen（全形中文友善，超長加刪節號）。 */
export function truncateCJK(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)) + "…";
}

/**
 * 旁白修剪：超過上限時，取上限內最後一個句尾標點（。！？；…）作為切點，
 * 避免硬切在詞中間讓 TTS 唸出斷句。找不到句尾標點才硬切。
 */
export function clipNarration(text: string, max = 240): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const m = t.slice(0, max).match(/^[\s\S]*[。！？；…]/u);
  return m ? m[0] : t.slice(0, max);
}
