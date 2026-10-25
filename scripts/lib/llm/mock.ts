import type { ArticleCopy, ArticleInput, IntroOutro, IntroOutroInput, LLMProvider } from "./types.ts";

/** 固定輸出，供單元測試與 dry-run 使用（無網路、無 key）。 */
export class MockLLM implements LLMProvider {
  readonly name = "mock";

  async generateSummaries(articles: ArticleInput[]): Promise<ArticleCopy[]> {
    return articles.map((_, i) => ({
      shortHeadline: `本週焦點 ${i + 1}`,
      narration: `這是第 ${i + 1} 篇文章的測試旁白，用來驗證管線的語音時長估算與字幕切分邏輯是否正常運作。`,
      tag: "測試分類",
    }));
  }

  async generateIntroOutro(input: IntroOutroInput): Promise<IntroOutro> {
    return {
      intro: `測試開場白：mobileai 週報 ${input.dateLabel}，本週共有 ${input.articleTitles.length} 篇文章。`,
      outro: "測試結尾：完整內容請上 mobileai.net，我們下週見。",
    };
  }
}
