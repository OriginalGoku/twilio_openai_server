import type { FastifyReply, FastifyRequest } from "fastify";

import { config, toWsUrl } from "../config/env.js";

interface TwimlQuery {
  callbackId?: string;
}

export async function outboundTwimlHandler(
  request: FastifyRequest<{ Querystring: TwimlQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const callbackId = request.query.callbackId ?? "";
  const mediaStreamUrl = toWsUrl(
    config.BASE_URL,
    `/media-stream/${encodeURIComponent(callbackId)}`,
  );
  const escapedCallbackId = callbackId
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${mediaStreamUrl}">
      <Parameter name="callbackId" value="${escapedCallbackId}" />
    </Stream>
  </Connect>
</Response>`;

  reply.header("Content-Type", "text/xml").send(twiml);
}
