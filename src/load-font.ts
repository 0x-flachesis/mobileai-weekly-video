import { continueRender, delayRender, staticFile } from "remotion";
import { theme } from "./theme";

let injected = false;

/** 注入 @font-face 並等待 Noto Sans TC 就緒（headless shell 中 FontFace API 不可靠，改走 CSS 注入）。 */
export function loadFonts(): void {
  if (injected) return;
  injected = true;
  const handle = delayRender("載入 NotoSansTC");

  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: "${theme.font}";
      src: url("${staticFile("fonts/NotoSansTC-VF.ttf")}") format("truetype-variations");
      font-weight: 100 900;
      font-style: normal;
      font-display: block;
    }
  `;
  document.head.appendChild(style);

  const done = () => continueRender(handle);
  if (typeof document !== "undefined" && document.fonts?.load) {
    Promise.all([
      document.fonts.load('900 64px "NotoSansTC"'),
      document.fonts.load('500 34px "NotoSansTC"'),
    ])
      .then(() => document.fonts.ready)
      .then(done)
      .catch(done);
  } else {
    done();
  }
}
