/** TTS adapter 介面。 */

export interface SynthOptions {
  /** 輸出檔絕對或相對路徑（.mp3） */
  outfile: string;
  /** 覆寫預設語音（可選） */
  voice?: string;
  /** 覆寫語速（可選，1 = 原速） */
  speed?: number;
}

export interface SynthResult {
  audioPath: string;
  /** 以 ffprobe 實測的時長（秒） */
  durationSec: number;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, opts: SynthOptions): Promise<SynthResult>;
}
