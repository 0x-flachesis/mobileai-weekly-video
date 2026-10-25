/** LLM adapter 介面（domain-level，非 raw chat）。 */

export interface ArticleInput {
  guid: string;
  title: string;
  link: string;
  publishedISO: string;
  categories: string[];
  /** RSS description（excerpt） */
  excerpt: string;
  /** 文章頁面抽出的內文（已截斷） */
  contentText: string;
  imageUrl?: string;
}

export interface ArticleCopy {
  shortHeadline: string;
  narration: string;
  tag: string;
}

export interface IntroOutro {
  intro: string;
  outro: string;
}

export interface IntroOutroInput {
  week: string;
  dateLabel: string;
  articleTitles: string[];
}

export interface LLMProvider {
  readonly name: string;
  /** 一次產出所有文章的短標/口白/分類（維持文章順序）。 */
  generateSummaries(articles: ArticleInput[]): Promise<ArticleCopy[]>;
  generateIntroOutro(input: IntroOutroInput): Promise<IntroOutro>;
}
