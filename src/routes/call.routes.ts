import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { initiateOutboundCall } from "../telephony/outbound-call.js";

const requestSchema = z.object({
  callbackId: z.string().min(1),
  to: z.string().min(1),
  record: z.boolean().default(false)
});

const callRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/call/initiate", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.issues.map((issue) => issue.message).join(", ")
      });
    }

    try {
      const result = await initiateOutboundCall(parsed.data);
      return reply.send({ success: true, callSid: result.callSid, status: result.status });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Failed to initiate call"
      });
    }
  });
};

export default callRoutes;
