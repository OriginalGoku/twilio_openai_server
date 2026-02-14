import { amazonNovaSonicRealtimeProvider } from "./providers/amazon-nova-sonic.js";
import { elevenLabsRealtimeProvider } from "./providers/elevenlabs.js";
import { geminiRealtimeProvider } from "./providers/gemini.js";
import { openAiRealtimeProvider } from "./providers/openai.js";
import type {
  RealtimeProvider,
  RealtimeProviderConfig,
} from "./providers/types.js";

export const realtimeConfig = {
  // activeProvider: "openai" as RealtimeProvider,
  activeProvider: "gemini" as RealtimeProvider,

  providers: {
    openai: openAiRealtimeProvider,
    gemini: geminiRealtimeProvider,
    elevenlabs: elevenLabsRealtimeProvider,
    amazon_nova_sonic: amazonNovaSonicRealtimeProvider,
  },
};

export function getActiveRealtimeProviderConfig(): RealtimeProviderConfig {
  return realtimeConfig.providers[realtimeConfig.activeProvider];
}
