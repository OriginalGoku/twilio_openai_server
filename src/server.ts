// curl -X POST "https://0a4f-2607-fea8-3f9d-5200-403-fc3d-4f36-a58a.ngrok-free.app/call/initiate" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "callbackId": "e2e-test-001",
//     "to": "+13653246525",
//     "record": false
//   }'
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { config } from "./config/env.js";
import callRoutes from "./routes/call.routes.js";
import healthRoutes from "./routes/health.routes.js";
import twimlRoutes from "./routes/twiml.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import { mediaStreamRoutes } from "./telephony/media-stream.js";
import { setupGracefulShutdown } from "./utils/graceful-shutdown.js";
import { logger, loggerOptions } from "./utils/logger.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
});

async function buildServer() {
  const fastify = Fastify({ logger: loggerOptions });

  await fastify.register(formbody);
  await fastify.register(websocket);

  await fastify.register(healthRoutes);
  await fastify.register(callRoutes);
  await fastify.register(twimlRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(mediaStreamRoutes);

  setupGracefulShutdown(fastify);

  return fastify;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({
      port: config.PORT,
      host: "0.0.0.0",
    });

    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      "Caller engine started",
    );
  } catch (error) {
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

void start();
