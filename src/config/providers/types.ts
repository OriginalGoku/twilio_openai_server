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

export interface GeminiRealtimeProviderConfig extends BaseRealtimeProviderConfig {
  provider: "gemini";
  voiceName: string;
}

export interface ExternalRealtimeProviderConfig
  extends BaseRealtimeProviderConfig {
  provider: "elevenlabs" | "amazon_nova_sonic";
}

export type RealtimeProviderConfig =
  | OpenAiRealtimeProviderConfig
  | GeminiRealtimeProviderConfig
  | ExternalRealtimeProviderConfig;
