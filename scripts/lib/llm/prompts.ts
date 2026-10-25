import type { ArticleInput, IntroOutroInput } from "./types.ts";

/** Prompt 模板集中管理（台灣繁體中文，輸出 JSON）。 */

export const SUMMARY_SYSTEM = `你是台灣科技媒體的影音腳本編輯，為「mobileai 週報」撰寫每篇文章的短影音文案。
只能輸出 JSON，不得輸出其他文字或 code fence。使用台灣繁體中文。`;

export function summaryUserPrompt(articles: ArticleInput[]): string {
  const items = articles.map((a, i) => ({
    index: i,
    title: a.title,
    categories: a.categories,
    excerpt: a.excerpt.slice(0, 400),
    content: a.contentText.slice(0, 2000),
  }));
  return `以下是本週文章（index 為對應鍵）。請為每篇產生：

1. shortHeadline：不超過 14 個字的短標，抓最吸睛的重點，可含產品或技術名稱。
2. narration：40 到 60 個字的旁白文稿，口語自然但保留專業度，適合朗讀。不要出現「大家好」、網址、標題符號或引號，只要單段文字。
3. tag：不超過 6 個字的分類，例如「APP 教學」「AI 工具」「開箱實測」「生活科技」。

輸出格式：
{"articles":[{"index":0,"shortHeadline":"…","narration":"…","tag":"…"}, …]}
index 順序必須與輸入一致，每篇文章都要有一筆。

文章資料：
${JSON.stringify(items, null, 1)}`;
}

export const INTRO_OUTRO_SYSTEM = `你是台灣科技媒體的影音腳本編輯。只能輸出 JSON，不得輸出其他文字或 code fence。使用台灣繁體中文。`;

export function introOutroUserPrompt(input: IntroOutroInput): string {
  return `本週（${input.dateLabel}）mobileai 週報收錄了 ${input.articleTitles.length} 篇文章：
${input.articleTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

請產生：
1. intro：18 到 30 個字的開場白，點出「mobileai 週報」與本週內容概況，語氣親切有精神。
2. outro：22 到 36 個字的結尾，引導觀眾到 mobileai.net 閱讀完整內容，並邀請訂閱追蹤每週更新。

輸出格式：{"intro":"…","outro":"…"}`;
}
