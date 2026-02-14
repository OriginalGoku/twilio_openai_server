import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    PORT: z.string().default("5050"),
    NODE_ENV: z.string().default("development"),
    BASE_URL: z.string().url(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    ELEVENLABS_API_KEY: z.string().min(1).optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1),
    TWILIO_AUTH_TOKEN: z.string().min(1),
    TWILIO_PHONE_NUMBER: z.string().min(1),
    GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
    GOOGLE_PRIVATE_KEY: z.string().optional(),
    GOOGLE_CALENDAR_ID: z.string().optional(),
    GOOGLE_IMPERSONATED_USER: z.string().email().optional(),
    CALL_TIME_LIMIT: z.string().default("300"),
    VERBOSE: z.string().default("true"),
    TIMING_LOG: z.string().default("false"),
    SYSTEM_PROMPT: z.string().optional(),
    BUSINESS_TIMEZONE: z.string().default("UTC"),
    WORKDAY_START_HOUR: z.string().default("9"),
    WORKDAY_END_HOUR: z.string().default("20"),
    ENABLE_CALENDAR_TOOLS: z.string().default("true"),
    ENABLE_EMAIL_TOOLS: z.string().default("false"),
  })
  .transform((raw) => ({
    ...raw,
    PORT: Number(raw.PORT),
    CALL_TIME_LIMIT: Number(raw.CALL_TIME_LIMIT),
    BASE_URL: raw.BASE_URL.replace(/\/+$/, ""),
    GOOGLE_PRIVATE_KEY: raw.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    WORKDAY_START_HOUR: Number(raw.WORKDAY_START_HOUR),
    WORKDAY_END_HOUR: Number(raw.WORKDAY_END_HOUR),
    VERBOSE: raw.VERBOSE.toLowerCase() === "true",
    TIMING_LOG: raw.TIMING_LOG.toLowerCase() === "true",
    ENABLE_CALENDAR_TOOLS: raw.ENABLE_CALENDAR_TOOLS.toLowerCase() === "true",
    ENABLE_EMAIL_TOOLS: raw.ENABLE_EMAIL_TOOLS.toLowerCase() === "true",
  }))
  .superRefine((data, ctx) => {
    if (Number.isNaN(data.PORT) || data.PORT < 1 || data.PORT > 65535) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PORT"],
        message: "PORT must be a valid port number",
      });
    }

    if (Number.isNaN(data.CALL_TIME_LIMIT) || data.CALL_TIME_LIMIT < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CALL_TIME_LIMIT"],
        message: "CALL_TIME_LIMIT must be a positive integer",
      });
    }

    if (data.ENABLE_CALENDAR_TOOLS || data.ENABLE_EMAIL_TOOLS) {
      if (!data.GOOGLE_CLIENT_EMAIL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GOOGLE_CLIENT_EMAIL"],
          message:
            "GOOGLE_CLIENT_EMAIL is required when Google tools are enabled",
        });
      }

      if (!data.GOOGLE_PRIVATE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GOOGLE_PRIVATE_KEY"],
          message:
            "GOOGLE_PRIVATE_KEY is required when Google tools are enabled",
        });
      }
    }

    if (data.ENABLE_CALENDAR_TOOLS && !data.GOOGLE_CALENDAR_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CALENDAR_ID"],
        message:
          "GOOGLE_CALENDAR_ID is required when calendar tools are enabled",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const errors = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${errors}`);
}

export const config: AppConfig = parsed.data;

export function toWsUrl(httpUrl: string, path: string): string {
  const url = new URL(path, httpUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  return url.toString();
}
