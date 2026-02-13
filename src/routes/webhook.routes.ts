import type { FastifyPluginAsync } from "fastify";

import { callStatusCallbackHandler } from "../telephony/status-callback.js";

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/webhooks/call-status", callStatusCallbackHandler);
};

export default webhookRoutes;
