import { tool } from "@openai/agents";
import { google } from "googleapis";
import { z } from "zod";

import { config } from "../../config/env.js";

const authClient =
  config.ENABLE_EMAIL_TOOLS && config.GOOGLE_CLIENT_EMAIL && config.GOOGLE_PRIVATE_KEY
    ? new google.auth.JWT({
        email: config.GOOGLE_CLIENT_EMAIL,
        key: config.GOOGLE_PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/gmail.send"],
        subject: config.GOOGLE_IMPERSONATED_USER
      })
    : null;

const gmail = authClient ? google.gmail({ version: "v1", auth: authClient }) : null;

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export const sendEmailTool = tool({
  name: "send_email",
  description: "Send an email to a specified address. Use this to send appointment confirmations or follow-up information.",
  parameters: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1)
  }),
  async execute({ to, subject, body }) {
    if (!config.ENABLE_EMAIL_TOOLS || !gmail || !config.GOOGLE_IMPERSONATED_USER) {
      return { error: "Email tool is not enabled" };
    }

    try {
      const message = [
        `To: ${to}`,
        `From: ${config.GOOGLE_IMPERSONATED_USER}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body
      ].join("\r\n");

      const response = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: toBase64Url(message)
        }
      });

      return { status: "sent", messageId: response.data.id };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to send email" };
    }
  }
});
