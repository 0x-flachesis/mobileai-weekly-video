import type { LLMConfig } from "../config.ts";
import type { LLMProvider } from "./types.ts";
import { OpenAICompatibleLLM } from "./openai-compatible.ts";
import { PassthroughLLM } from "./passthrough.ts";
import { MockLLM } from "./mock.ts";

export function createLLM(cfg: LLMConfig): LLMProvider {
  switch (cfg.provider) {
    case "openai-compatible":
      return new OpenAICompatibleLLM(cfg);
    case "passthrough":
      return new PassthroughLLM();
    case "mock":
      return new MockLLM();
  }
}
