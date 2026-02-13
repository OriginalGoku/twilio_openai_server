import OpenAI from "openai";

import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { TranscriptResult } from "./collector.js";

export interface CallMetadata {
  callSid: string;
  callbackId: string;
  duration: number;
  recordingUrl?: string;
  recordingSid?: string;
}

export interface PostCallResult {
  callSid: string;
  callbackId: string;
  transcript: string;
  summary?: string;
  structuredData?: {
    intent: string;
    outcome: string;
    nextAction: string;
    scheduledDate?: string;
    sentiment: string;
  };
  recordingUrl?: string;
  duration: number;
}

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function processPostCall(
  transcript: TranscriptResult,
  callMetadata: CallMetadata
): Promise<PostCallResult> {
  const result: PostCallResult = {
    callSid: callMetadata.callSid,
    callbackId: callMetadata.callbackId,
    transcript: transcript.fullText,
    recordingUrl: callMetadata.recordingUrl,
    duration: callMetadata.duration
  };

  if (!transcript.fullText.trim()) {
    return result;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Summarize phone call transcripts. Return strict JSON with keys: summary, intent, outcome, nextAction, scheduledDate, sentiment."
        },
        {
          role: "user",
          content: transcript.fullText
        }
      ]
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return result;
    }

    const parsed = JSON.parse(content) as {
      summary?: string;
      intent?: string;
      outcome?: string;
      nextAction?: string;
      scheduledDate?: string;
      sentiment?: string;
    };

    result.summary = parsed.summary;
    result.structuredData = {
      intent: parsed.intent ?? "",
      outcome: parsed.outcome ?? "",
      nextAction: parsed.nextAction ?? "",
      scheduledDate: parsed.scheduledDate,
      sentiment: parsed.sentiment ?? "neutral"
    };

    return result;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : "unknown" },
      "Post-call summary generation failed"
    );
    return result;
  }
}
