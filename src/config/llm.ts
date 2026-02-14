export type RealtimeProvider =
  | "openai"
  | "gemini"
  | "elevenlabs"
  | "amazon_nova_sonic";

interface BaseRealtimeProviderConfig {
  provider: RealtimeProvider;
  model: string;
}

export interface OpenAiRealtimeProviderConfig extends BaseRealtimeProviderConfig {
  provider: "openai";
  voice: string;
}

export interface ExternalRealtimeProviderConfig
  extends BaseRealtimeProviderConfig {
  provider: Exclude<RealtimeProvider, "openai">;
}

export type RealtimeProviderConfig =
  | OpenAiRealtimeProviderConfig
  | ExternalRealtimeProviderConfig;

export const realtimeConfig = {
  activeProvider: "openai" as RealtimeProvider,
  providers: {
    openai: {
      provider: "openai",
      model: "gpt-realtime",
      voice: "marin",
    } as OpenAiRealtimeProviderConfig,
    gemini: {
      provider: "gemini",
      model: "gemini-2.0-flash-live-001",
    } as ExternalRealtimeProviderConfig,
    elevenlabs: {
      provider: "elevenlabs",
      model: "eleven_v3",
    } as ExternalRealtimeProviderConfig,
    amazon_nova_sonic: {
      provider: "amazon_nova_sonic",
      model: "amazon.nova-sonic-v1:0",
    } as ExternalRealtimeProviderConfig,
  },
};

export function getActiveRealtimeProviderConfig(): RealtimeProviderConfig {
  return realtimeConfig.providers[realtimeConfig.activeProvider];
}
