import { RealtimeAgent } from "@openai/agents/realtime";

import { businessConfig } from "../config/business.js";
import { config } from "../config/env.js";
import { agentTools } from "./tools/index.js";
import { buildPrompt, type PromptOverrides } from "./prompts.js";

interface CreateAgentOptions {
  instructions?: string;
  businessContext?: PromptOverrides;
}

export function createAgent(options?: CreateAgentOptions): RealtimeAgent {
  const prompt = buildPrompt({
    ...businessConfig,
    ...(options?.businessContext ?? {}),
  });

  return new RealtimeAgent({
    name: "ClientAgent",
    model: config.OPENAI_REALTIME_MODEL,
    instructions: options?.instructions ?? config.SYSTEM_PROMPT ?? prompt,
    voice: config.OPENAI_VOICE,
    tools: agentTools,
  });
}
