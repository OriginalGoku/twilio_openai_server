import twilio from "twilio";

import { config } from "../config/env.js";

export interface OutboundCallParams {
  to: string;
  callbackId: string;
  record: boolean;
}

export interface OutboundCallResult {
  callSid: string;
  status: string;
}

const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

export async function initiateOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult> {
  try {
    const call = await client.calls.create({
      to: params.to,
      from: config.TWILIO_PHONE_NUMBER,
      url: `${config.BASE_URL}/twiml/outbound?callbackId=${encodeURIComponent(params.callbackId)}`,
      statusCallback: `${config.BASE_URL}/webhooks/call-status`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeLimit: config.CALL_TIME_LIMIT,
      record: params.record,
      machineDetection: "Enable"
    });

    return { callSid: call.sid, status: call.status ?? "queued" };
  } catch (error) {
    throw new Error(
      `Failed to initiate outbound call: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}
