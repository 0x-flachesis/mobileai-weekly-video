# mobileai-weekly-video

每週一早上九點（台北時間）自動將 [mobileai.net](https://mobileai.net/)（傳說中的挨踢部門）過去一週的新文章，
製作成一支橫式 1920×1080@30fps 的「週報精華影片」：RSS → LLM 撰稿 → TTS 旁白 → Remotion 渲染 MP4。

影片手法參考 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)：節拍同步剪輯、一鏡一效果、
重點留白、SFX 音效釘選、確定性渲染（seeded PRNG，同一份 storyboard 永遠渲染出相同結果）。

## 快速開始

```bash
# 需求：Node.js >= 24（.nvmrc 已鎖定）、ffmpeg、curl、Python edge-tts（見下）
npm install
cp .env.example .env          # 全部可選；不填 key 也能跑

npm run weekly                # 一鍵全流程（真實 feed + edge-tts 旁白）
npm run weekly -- --mock      # 全 mock 模式（不需任何網路 API，驗證管線用）
npm run weekly -- --date 2026-10-25 --max 3   # 指定執行日、最多 3 篇
npm run weekly -- --skip-render               # 只跑到 storyboard（快速驗證）
npm test                      # 單元測試（node --test）
```

成品：`output/weekly-<ISO週>.mp4`，每週資料與分鏡存於 `data/issues/<ISO週>/`。
GitHub Actions 執行時會自動發布到 **Releases**（tag `weekly-<ISO週>`）：MP4 + SRT 字幕 + 自動生成的說明（文章清單、完整旁白稿），永久保存、可直接外連下載；本地可用 `npm run release -- --dry-run` 預覽。

## Pipeline

```
┌─────────┐   ┌───────────┐   ┌───────┐   ┌─────────────┐   ┌────────┐   ┌────────┐
│ 1 fetch │ → │ 2 summarize│ → │ 3 tts │ → │ 4+5 storyboard│ → │ 6 render│ → │ 7 qa  │
└─────────┘   └───────────┘   └───────┘   └─────────────┘   └────────┘   └────────┘
  RSS 過濾      LLM adapter    TTS adapter   段落×節拍對齊      Remotion     ffprobe
  7 天新文章    短標/口白/tag   旁白+時長      字幕/KenBurns     h264 MP4     抽格存證
```

| 階段 | 腳本 | 說明 |
| --- | --- | --- |
| 1 | `scripts/fetch-feed.mjs` | 抓 feed → 過濾 `pubDate ≥ 執行日−7天` → **WordPress REST API（`wp-json/wp/v2/posts` + `_embed`）取全文、特色圖與分類**；API 不可用時退回頁面抓版（og:image＋內文），再退回 excerpt。HTTP 走 curl 通過 Cloudflare |
| 2 | `scripts/summarize.mjs` | LLM adapter：每篇短標（≤14 字）、旁白（字數隨文章數自適應：≤3 篇 90–130 字、4–5 篇 70–100、≥6 篇 50–75）、分類；另產開場/結尾詞。passthrough 模式從全文以**句界切分**（完整句 20–110 字，頓號不切）產生口白，不硬截斷 |
| 3 | `scripts/tts.mjs` | TTS adapter：合成 intro/各段/outro 旁白，ffprobe 量精確時長 |
| 4+5 | `scripts/storyboard.mjs` | 段落時長＝語音+緩衝 → 吸附 BGM 節拍；組字幕 cue、KenBurns 運鏡、SFX 釘選 |
| 6 | `scripts/render.mjs` | Remotion 渲染 h264 MP4（音軌＝BGM 0.34 + 旁白 + SFX） |
| 7 | `scripts/qa.mjs` | ffprobe 檢查規格（1920×1080/30fps/h264/音軌/時長）＋每段抽 2 格存證 |

總指揮：`scripts/run-weekly.mjs`。沒有新文章時記錄 state 後跳過，不產空片。

## Adapter 架構（LLM / TTS）

`scripts/lib/` 以介面 + factory 實作，**換 provider 不改 pipeline**：

```
scripts/lib/
├── config.ts          # 統一 env 解析（.env 支援）
├── llm/               # LLMProvider
│   ├── openai-compatible.ts  # GLM / OpenAI / Ollama…（chat completions + JSON 修正重試）
│   ├── passthrough.ts        # 零 key fallback：RSS 標題+摘要直接用
│   └── mock.ts               # 固定輸出（測試/dry-run）
└── tts/               # TTSProvider
    ├── edge-tts.ts           # 免費（Microsoft 線上語音，走 Python edge-tts CLI）
    ├── minimax.ts            # MiniMax T2A v2（送出前自動繁→簡（台灣用語→大陸詞彙）、hex 音訊、限流退避、時長交叉檢查）
    ├── openai-compatible.ts  # /audio/speech 端點
    └── mock.ts               # 靜音 MP3（dry-run 不需網路）
```

**選擇規則**（可用環境變數明確覆寫，見 `.env.example`）：

- `LLM_PROVIDER` 未設：有 `LLM_API_KEY` → `openai-compatible`，否則 `passthrough`
- `TTS_PROVIDER` 未設：有 `MINIMAX_API_KEY` → `minimax`；有 `TTS_API_KEY` → `openai-compatible`；否則 `edge`

### 新增 provider

1. 在 `scripts/lib/llm/`（或 `tts/`）新增實作，實作 `LLMProvider`（`generateSummaries` / `generateIntroOutro`）
   或 `TTSProvider`（`synthesize`）介面
2. 在 `config.ts` 加 config 型別與解析
3. 在 `factory.ts` 註冊
4. 加單元測試（stub fetch，見 `test/minimax-tts.test.ts`）

### TTS 需求：edge 模式

`edge` 模式使用 Python [`edge-tts`](https://github.com/rany2/edge-tts) CLI（npm 的 msedge-tts 已失效）。
偵測順序：`EDGE_TTS_BIN` → `edge-tts` → `uvx edge-tts`。本機安裝任一種即可：

```bash
pip install edge-tts      # 或安裝 uv 後自動以 uvx 執行
```

### OpenRouter：免費模型全自動

`LLM_BASE_URL=https://openrouter.ai/api/v1` 且 `LLM_MODEL` **留空（或填 `auto:free`）**即可：
執行時自動呼叫 `/v1/models` 抓當下所有 `:free` 模型 → 排除審核/嵌入類
（content-safety、guard、embed…）→ instruction-tuned 優先、context 長度排序 →
取前 4 個組成 OpenRouter `models` fallback 陣列（限流/不可用自動切下一個，
實際路由到的模型會印在 log）。清單抓不到時退回內建備援清單，不中斷流程。

也可手動指定逗號分隔清單：`LLM_MODEL=模型A:free,模型B:free`。

## 每週一 09:00 排程（GitHub Actions）

`.github/workflows/weekly-video.yml`：`cron: "0 1 * * 1"`（UTC）＝台北週一 09:00，另支援手動
`workflow_dispatch`（可指定 date/mock/max）。

1. 將 repo 推到 GitHub
2. 設定 Secrets（可選）：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`、`MINIMAX_API_KEY`…（見 workflow 檔）
3. Actions 頁手動 dispatch 一次驗證
4. 之後每週自動執行：影片發布到 Releases（MP4+SRT+說明）、每週資料自動 commit 回 main

本機排程可自行使用 cron / systemd timer：`0 9 * * 1 cd <repo> && npm run weekly`。

## 視覺與聲音設計（借鏡 video-shotcraft）

- **設計系統取自 mobileai.net 本身**：`src/theme.ts`（`#f5f7fb` 淺底、`#32373c` 墨色、`#007cba` 強調藍）
- **節拍同步**：BGM 由 `scripts/gen-bgm.mjs` 純數學合成（110/100/120 BPM 三首輪替）→ BPM 已知，
  剪輯點吸附誤差 ≤ 半拍；全片強拍 slam ≤3 次
- **一鏡一效果**：開場＝標題 clip-reveal 上滑、文章段＝短標逐行進場、結尾＝列表逐條淡入
- **重點留白**：標題 lockup 進場後定版不動（≥1s）、開場動作 3s
- **音效釘選**：whoosh（段落轉場，音量 0.40/0.25 交替避免連發）、impact（開場/結尾）、riser（結尾前導）；
  BGM 音量 0.34 保留 headroom 給旁白，結尾 2s 淡出
- **確定性**：全程禁 `Math.random()`/`Date.now()`（seeded mulberry32，seed＝週次雜湊）
- **運動曲線**：`cubic-bezier(0,0,0.2,1)`、進場 21 格、逐行 stagger 6 格
- **SFX**：`scripts/gen-sfx.mjs` 合成（whoosh/impact/riser），無版權疑慮
- **字體**：Noto Sans TC 可變字重內嵌於 `public/fonts/`，確保本機與 CI 一致

資產重生成：`npm run assets`（gen-sfx + gen-bgm）。

## 版面結構

```
[開場卡 3-6s]                [文章段 每篇 6-16s]                  [結尾卡 4-7s]
 mobileai 週報                左：封面圖 KenBurns + 編號            本週速覽（標題列表）
 日期膠囊・篇數               右：tag 膠囊 → 短標逐行 → 分隔線      mobileai.net
 (impact @ 標題落點)          底部：旁白字幕藥丸 + 來源網址         CTA 膠囊
```

總長目標 60–90s（文章多時自動壓縮每段時長），QA 硬上限 120s。

## 邊界情況

- 一週沒有新文章 → 記 state、跳過（不產空片）
- 文章頁抓不到 / 無 og:image → 降級純文字卡＋主題色漸層
- feed 失敗 → 指數退避重試 3 次，失敗讓排程紅燈
- LLM 回應非法 JSON → 自動帶錯誤回饋重試一次
- MiniMax 限流（1002/1039）→ 指數退避重試；音檔時長與 `extra_info` 交叉檢查 >5% 視為異常

## 授權與使用須知

- 影片內容（文章標題、摘要、封面圖）版權屬 mobileai.net 作者，本專案產出之影片為
  「摘要＋引用＋連結」性質之個人使用；正式公開發佈前請取得授權
- BGM 與 SFX 由本專案程式合成（`scripts/gen-bgm.mjs` / `gen-sfx.mjs`），無第三方版權
- 字體 Noto Sans TC 採 [OFL 授權](https://github.com/google/fonts/blob/main/ofl/notosanstc/OFL.txt)
- Remotion：個人／小團隊免費，公司使用需[付費授權](https://www.remotion.pro/license)
