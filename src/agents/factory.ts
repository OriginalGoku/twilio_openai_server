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

export function resolveAgentInstructions(options?: CreateAgentOptions): string {
  const prompt = buildPrompt({
    ...businessConfig,
    ...(options?.businessContext ?? {}),
  });
  return options?.instructions ?? config.SYSTEM_PROMPT ?? prompt;
}

export function createAgent(options?: CreateAgentOptions): RealtimeAgent {
  const providerConfig = getActiveRealtimeProviderConfig();

  if (providerConfig.provider !== "openai") {
    throw new Error(
      `Provider "${providerConfig.provider}" is configured but not implemented for RealtimeAgent creation.`,
    );
  }

  return new RealtimeAgent({
    name: "ClientAgent",
    model: providerConfig.model,
    instructions: resolveAgentInstructions(options),
    voice: providerConfig.voice,
    tools: agentTools,
  });
}
