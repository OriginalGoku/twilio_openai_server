import type { WebSocket } from "@fastify/websocket";
import { RealtimeSession } from "@openai/agents/realtime";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";

import { createAgent, resolveAgentInstructions } from "../agents/factory.js";
import { config } from "../config/env.js";
import { getActiveRealtimeProviderConfig } from "../config/llm.js";
import { GeminiTwilioRealtimeSession } from "./providers/gemini-session.js";

interface RealtimeSessionLike {
  on(event: string, listener: (event: any) => void): void;
  sendMessage(message: unknown, otherEventData?: Record<string, any>): void;
  close(): void | Promise<void>;
}

interface RealtimeBridge {
  provider: string;
  model: string;
  transport: any | null;
  session: RealtimeSessionLike;
  connect: () => Promise<void>;
}

export function createRealtimeBridge(socket: WebSocket): RealtimeBridge {
  const activeProvider = getActiveRealtimeProviderConfig();

  if (activeProvider.provider === "openai") {
    if (!config.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when provider is openai.");
    }

    const transport = new TwilioRealtimeTransportLayer({
      twilioWebSocket: socket,
    } as any);
    const agent = createAgent();
    const session = new RealtimeSession(agent, {
      transport,
    } as any);

    return {
      provider: activeProvider.provider,
      model: activeProvider.model,
      transport,
      session,
      connect: async () => {
        await session.connect({
          apiKey: config.OPENAI_API_KEY,
          model: activeProvider.model,
          config: {
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
            },
          },
        } as any);
      },
    };
  }

  if (activeProvider.provider === "gemini") {
    if (!config.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required when provider is gemini.");
    }

    const session = new GeminiTwilioRealtimeSession({
      twilioWebSocket: socket,
      apiKey: config.GEMINI_API_KEY,
      model: activeProvider.model,
      voiceName: activeProvider.voiceName,
      instructions: resolveAgentInstructions(),
    });

    return {
      provider: activeProvider.provider,
      model: activeProvider.model,
      transport: null,
      session,
      connect: async () => {
        await session.connect();
      },
    };
  }

  throw new Error(
    `Realtime provider "${activeProvider.provider}" is configured but not implemented yet. ` +
      "Add a provider adapter in src/llm/realtime-provider.ts.",
  );
}
