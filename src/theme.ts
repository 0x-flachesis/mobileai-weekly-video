/**
 * 設計系統 — 取自 mobileai.net 自身視覺（淺色編輯風）：
 * 背景 #f5f7fb（站方 theme-color）、墨色 #32373c（站方 CSS 實際使用值）、
 * 強調藍 #007cba（站方 admin theme-color 家族）。
 * 運動曲線採 video-shotcraft 的 editorial 預設：~21-24f, cubic-bezier(0,0,0.2,1)。
 */
import { Easing } from "remotion";

export const theme = {
  bg: "#f5f7fb",
  surface: "#ffffff",
  ink: "#32373c",
  inkSoft: "#575e66",
  inkFaint: "#8a9199",
  accent: "#007cba",
  accentDeep: "#005a87",
  accentSoft: "#dceef8",
  line: "#d9dee6",
  danger: "#cf2e2e",
  font: "NotoSansTC",
};

export const fontFamily = `"${theme.font}", "PingFang TC", "Microsoft JhengHei", sans-serif`;

/** video-shotcraft 風格運動曲線：editorial 檔（大約 21-24 格、decelerate）。 */
export const EASE_OUT = Easing.bezier(0, 0, 0.2, 1);
export const ENTER_FRAMES = 21;
export const STAGGER = 6;

/** px → Remotion 常用尺寸 */
export const size = {
  display: 128,
  headline: 64,
  headlineSmall: 52,
  body: 34,
  caption: 26,
  tiny: 21,
};
