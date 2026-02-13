import type { FastifyPluginAsync } from "fastify";

import { outboundTwimlHandler } from "../telephony/twiml.js";

const twimlRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.all("/twiml/outbound", outboundTwimlHandler);
};

export default twimlRoutes;
