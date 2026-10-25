import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** 以 ffprobe 取得媒體時長（秒）。 */
export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await pexec("ffprobe", [
    "-v",
    "quiet",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  const dur = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`ffprobe 無法取得 ${file} 的時長（輸出：${stdout.trim()}）`);
  }
  return dur;
}

/** 從影片抽出指定時間點的 PNG 畫格（QA 用）。 */
export async function extractFrame(video: string, atSec: number, outPng: string): Promise<void> {
  await pexec("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(atSec), "-i", video, "-frames:v", "1", outPng]);
}
