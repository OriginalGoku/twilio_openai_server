import { RealtimeAgent } from "@openai/agents/realtime";

import { config } from "../config/env.js";
import { agentTools } from "./tools/index.js";
import { DEFAULT_PROMPT } from "./prompts.js";

interface CreateAgentOptions {
  instructions?: string;
}

export function createAgent(options?: CreateAgentOptions): RealtimeAgent {
  return new RealtimeAgent({
    name: "ClientAgent",
    model: config.OPENAI_REALTIME_MODEL,
    instructions: options?.instructions ?? config.SYSTEM_PROMPT ?? DEFAULT_PROMPT,
    voice: config.OPENAI_VOICE,
    tools: agentTools
  });
}
