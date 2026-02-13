import { tool } from "@openai/agents";
import twilio from "twilio";
import { z } from "zod";

import { config } from "../../config/env.js";

const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

export const sendSmsTool = tool({
  name: "send_sms",
  description: "Send an SMS message to a phone number. Use this to send appointment confirmations or meeting links.",
  parameters: z.object({
    to: z.string().min(1),
    message: z.string().min(1)
  }),
  async execute({ to, message }) {
    try {
      const response = await twilioClient.messages.create({
        to,
        from: config.TWILIO_PHONE_NUMBER,
        body: message
      });

      return { status: "sent", messageSid: response.sid };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to send SMS" };
    }
  }
});
