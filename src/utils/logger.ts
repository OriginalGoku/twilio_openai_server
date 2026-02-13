import pino from "pino";

import { config } from "../config/env.js";

const isProduction = config.NODE_ENV === "production";

export const loggerOptions = {
  level: isProduction ? "info" : "debug",
  base: {
    service: "caller-engine",
    env: config.NODE_ENV,
  },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
};

export const logger = pino(loggerOptions);
