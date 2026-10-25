import type { TTSConfig } from "../config.ts";
import type { TTSProvider } from "./types.ts";
import { EdgeTTS } from "./edge-tts.ts";
import { MinimaxTTS } from "./minimax.ts";
import { OpenAICompatibleTTS } from "./openai-compatible.ts";
import { MockTTS } from "./mock.ts";

export function createTTS(cfg: TTSConfig): TTSProvider {
  switch (cfg.provider) {
    case "edge":
      return new EdgeTTS(cfg);
    case "minimax":
      return new MinimaxTTS(cfg);
    case "openai-compatible":
      return new OpenAICompatibleTTS(cfg);
    case "mock":
      return new MockTTS(cfg);
  }
}
