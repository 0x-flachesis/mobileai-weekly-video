/**
 * 週次與路徑解析。排程錨點為台北時間（GitHub Actions cron UTC 01:00 週一 = 台北 09:00），
 * 所有日期計算固定以 Asia/Taipei 時區進行，確保本機與 CI 一致。
 */

export const TZ = "Asia/Taipei";

export interface WeekContext {
  /** ISO 週次，如 2026-W43 */
  week: string;
  runDateISO: string;
  windowStartISO: string;
  windowEndISO: string;
  /** 給人看的日期範圍，如 10/19 – 10/25 */
  dateLabel: string;
  /** data/issues/<week>/ */
  weekDir: string;
  /** public/assets/<week>/（音訊與圖片，staticFile 根目錄為 public/） */
  assetsDir: string;
  /** 相對於 public/ 的資產路徑，如 assets/2026-W43 */
  relAssetsDir: string;
}

interface TaipeiParts {
  year: number;
  month: number; // 1-12
  day: number;
}

function taipeiParts(date: Date): TaipeiParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** ISO-8601 週次（週一為一週之始）。 */
export function isoWeekOf(date: Date): { year: number; week: number } {
  const { year, month, day } = taipeiParts(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function resolveWeek(
  runDate: Date,
  opts?: { dataDir?: string; publicAssetsDir?: string; lookbackDays?: number },
): WeekContext {
  const { year, week } = isoWeekOf(runDate);
  const weekId = `${year}-W${String(week).padStart(2, "0")}`;
  const { year: y, month, day } = taipeiParts(runDate);
  const windowEnd = new Date(runDate.getTime());
  const windowStart = new Date(runDate.getTime() - (opts?.lookbackDays ?? 7) * 86400000);
  const s = taipeiParts(windowStart);
  const dateLabel = `${String(s.month).padStart(2, "0")}/${String(s.day).padStart(2, "0")} – ${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  const dataDir = opts?.dataDir ?? "data";
  const publicAssetsDir = opts?.publicAssetsDir ?? "public/assets";
  return {
    week: weekId,
    runDateISO: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    windowStartISO: windowStart.toISOString(),
    windowEndISO: windowEnd.toISOString(),
    dateLabel,
    weekDir: `${dataDir}/issues/${weekId}`,
    assetsDir: `${publicAssetsDir}/${weekId}`,
    relAssetsDir: `assets/${weekId}`,
  };
}

export interface RunState {
  processedGuids: string[];
  updatedAt: string;
  weeks: { week: string; articles: number; video?: string }[];
}
