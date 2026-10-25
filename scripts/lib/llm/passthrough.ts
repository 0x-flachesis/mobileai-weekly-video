import type { ArticleCopy, ArticleInput, IntroOutro, IntroOutroInput, LLMProvider } from "./types.ts";
import { truncateCJK } from "../util.ts";

/**
 * 零 LLM fallback：直接使用 RSS 標題與摘要，不經任何 API。
 * 短標取標題前段；口白取 excerpt 並裁切至口語長度。
 */
export class PassthroughLLM implements LLMProvider {
  readonly name = "passthrough";

  async generateSummaries(articles: ArticleInput[]): Promise<ArticleCopy[]> {
    return articles.map((a) => ({
      shortHeadline: truncateCJK(cleanTitle(a.title), 16),
      narration: cleanExcerpt(a.excerpt || a.contentText).slice(0, 60),
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
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/《原文出處[^》]*》/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
