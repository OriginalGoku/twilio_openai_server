import type { FastifyInstance } from "fastify";

import { logger } from "./logger.js";

const activeCalls = new Set<string>();

export function registerActiveCall(id: string): void {
  activeCalls.add(id);
}

export function unregisterActiveCall(id: string): void {
  activeCalls.delete(id);
}

export function setupGracefulShutdown(fastify: FastifyInstance): void {
  let shuttingDown = false;

  const onShutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ activeCalls: activeCalls.size }, "Shutdown signal received; draining active calls");

    await fastify.close();

    const timeoutMs = 280_000;
    const start = Date.now();

    while (activeCalls.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    if (activeCalls.size > 0) {
      logger.warn({ remainingCalls: activeCalls.size }, "Graceful shutdown timeout reached");
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void onShutdown();
  });

  process.on("SIGINT", () => {
    void onShutdown();
  });
}
