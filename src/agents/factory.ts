import { RealtimeAgent } from "@openai/agents/realtime";

import { businessConfig } from "../config/business.js";
import { config } from "../config/env.js";
import { getActiveRealtimeProviderConfig } from "../config/llm.js";
import { agentTools } from "./tools/index.js";
import { buildPrompt, type PromptOverrides } from "./prompts.js";

interface CreateAgentOptions {
  instructions?: string;
  businessContext?: PromptOverrides;
}

export function createAgent(options?: CreateAgentOptions): RealtimeAgent {
  const providerConfig = getActiveRealtimeProviderConfig();
  const prompt = buildPrompt({
    ...businessConfig,
    ...(options?.businessContext ?? {}),
  });

  if (providerConfig.provider !== "openai") {
    throw new Error(
      `Provider "${providerConfig.provider}" is configured but not implemented for RealtimeAgent creation.`,
    );
  }

  return new RealtimeAgent({
    name: "ClientAgent",
    model: providerConfig.model,
    instructions: options?.instructions ?? config.SYSTEM_PROMPT ?? prompt,
    voice: providerConfig.voice,
    tools: agentTools,
  });
}
