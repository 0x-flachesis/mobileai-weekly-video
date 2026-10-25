import type { ArticleCopy, ArticleInput, IntroOutro, IntroOutroInput, LLMProvider } from "./types.ts";
import { truncateCJK } from "../util.ts";

/**
 * 零 LLM fallback：從全文（contentText）萃取口白與短標，句界切分、不硬截斷。
 * 品質仍不如 LLM 撰稿，但完整反映文章開頭敘述。
 */
export class PassthroughLLM implements LLMProvider {
  readonly name = "passthrough";

  async generateSummaries(articles: ArticleInput[]): Promise<ArticleCopy[]> {
    return articles.map((a) => ({
      shortHeadline: makeHeadline(a.title),
      narration: makeNarration(a),
      tag: truncateCJK(a.categories[0] ?? "科技", 8),
    }));
  }

  async generateIntroOutro(input: IntroOutroInput): Promise<IntroOutro> {
    return {
      intro: `歡迎收看 mobileai 週報，帶你看本週 ${input.dateLabel} 的 ${input.articleTitles.length} 篇科技新內容。`,
      outro: "完整教學與更多內容，都在 mobileai.net，我們下週見。",
    };
  }
}

/** 短標：常見「主題：說明」型標題取主題段；否則切在標點或空白；最後才硬切。 */
export function makeHeadline(title: string): string {
  const t = cleanTitle(title);
  const m = t.match(/^([^：:！!？?，,、]{4,16})[：:！!？?，,、]/u);
  if (m) return m[1];
  // 16 字內的空白斷點（英數詞邊界）
  const head = t.slice(0, 17);
  const sp = head.lastIndexOf(" ", 16);
  if (sp >= 8) return t.slice(0, sp).trimEnd();
  return truncateCJK(t, 16);
}

/**
 * 口白：全文開頭去除標題重複後，在 40–80 字內找最後一個句末標點切分；
 * 找不到句號退而求其次用逗號，再不行才在 80 字硬切（加刪節號）。
 */
/**
 * 口白（zh-TW TTS 實測約 8 字/秒，110 字 ≈ 14 秒，為單段旁白合理上限）：
 * 1) 40–110 字內最後一個句末標點（。！？）→ 完整句
 * 2) 20–40 字內的句末標點 → 較短但完整的句子
 * 3) 40–80 字內的子句標點（，；：；不含頓號——列舉中斷唸起來突兀）
 * 4) 80 字硬切 + 刪節號
 */
export function makeNarration(a: ArticleInput): string {
  let source = (a.contentText || a.excerpt || "").trim();
  source = stripTitlePrefix(source, cleanTitle(a.title));
  if (!source) source = cleanExcerpt(a.excerpt);

  const cutAtLast = (text: string, from: number, to: number, punct: RegExp): string | null => {
    for (let i = to - 1; i >= from; i--) {
      if (punct.test(text[i] ?? "")) return text.slice(0, i + 1);
    }
    return null;
  };

  const sent = source.slice(0, 110);
  return (
    cutAtLast(sent, 40, sent.length, /[。！？!?]/u) ??
    cutAtLast(sent, 20, 40, /[。！？!?]/u) ??
    cutAtLast(source.slice(0, 80), 40, 80, /[，,；;：:]/u) ??
    truncateCJK(source, 80)
  );
}

/** 開頭若重複整段文章標題則移除（容忍空白差異與些許長度誤差）。 */
function stripTitlePrefix(source: string, title: string): string {
  const flatTitle = title.replace(/\s+/g, "");
  if (flatTitle.length < 6) return source;
  for (let k = flatTitle.length; k <= flatTitle.length + 6; k++) {
    if (source.slice(0, k).replace(/\s+/g, "") === flatTitle) {
      return source.slice(k).replace(/^[，,。.、：:；;\s]+/u, "");
    }
  }
  return source;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–|]\s*傳說中的挨踢部門\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExcerpt(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/《原文出處[^》]*》/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
