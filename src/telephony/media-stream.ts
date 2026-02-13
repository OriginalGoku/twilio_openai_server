import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { RealtimeSession } from "@openai/agents/realtime";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";

import { createAgent } from "../agents/factory.js";
import { config } from "../config/env.js";
import { TranscriptCollector } from "../transcription/collector.js";
import { processPostCall } from "../transcription/post-call.js";
import {
  registerActiveCall,
  unregisterActiveCall,
} from "../utils/graceful-shutdown.js";
import { logger } from "../utils/logger.js";

interface MediaStreamQuery {
  callbackId?: string;
}

interface MediaStreamParams {
  callbackId?: string;
}

export const mediaStreamRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: MediaStreamQuery; Params: MediaStreamParams }>(
    "/media-stream/:callbackId",
    { websocket: true },
    async (socket: WebSocket, request) => {
      let callbackId =
        request.params.callbackId ??
        request.query.callbackId ??
        `unknown-${Date.now()}`;

      const activeSessionId = `${callbackId}-${Date.now()}`;
      registerActiveCall(activeSessionId);

      const transcriptCollector = new TranscriptCollector();
      const agent = createAgent();
      let callSid = "unknown";
      let streamSid = "unknown";
      let isFinalized = false;
      let streamStarted = false;
      let sessionConnected = false;
      let greetingSent = false;

      logger.info(
        { callbackId, activeSessionId },
        "Incoming Twilio media-stream websocket",
      );

      const transport = new TwilioRealtimeTransportLayer({
        twilioWebSocket: socket,
      } as any);

      const session = new RealtimeSession(agent, {
        transport,
      } as any);

      const sendInitialGreetingIfReady = (): void => {
        if (!sessionConnected || !streamStarted || greetingSent) {
          return;
        }

        greetingSent = true;
        session.sendMessage(
          "The caller is now connected. Greet them briefly, introduce yourself, and ask how you can help.",
        );
        logger.info(
          { callbackId, callSid, streamSid },
          "Triggered initial greeting message",
        );
      };

      const captureStartData = (start: any): void => {
        callSid = start?.callSid ?? callSid;
        streamSid = start?.streamSid ?? streamSid;
        const callbackIdFromStart =
          start?.customParameters?.callbackId ??
          start?.customParameters?.callback_id;
        if (
          typeof callbackIdFromStart === "string" &&
          callbackIdFromStart.trim()
        ) {
          callbackId = callbackIdFromStart;
        }
        transcriptCollector.setCallSid(callSid);
        streamStarted = true;
        sendInitialGreetingIfReady();
      };

      transcriptCollector.attachToSession(session as any);

      socket.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed?.event === "start" && parsed?.start) {
            captureStartData(parsed.start);
            logger.info(
              {
                callbackId,
                callSid,
                streamSid,
                mediaFormat: parsed.start?.mediaFormat,
                customParameters: parsed.start?.customParameters,
              },
              "Twilio media stream started (raw socket event)",
            );
          }

          if (parsed?.event === "stop") {
            logger.info(
              {
                callbackId,
                callSid,
                streamSid,
                stopPayload: parsed.stop,
              },
              "Twilio media stream stop event (raw socket event)",
            );
          }
        } catch {
          // Ignore non-JSON websocket frames.
        }
      });

      session.on("transport_event", (event: any) => {
        const data = event?.event ?? event;
        if (data?.event === "start") {
          captureStartData(data.start);
          logger.info(
            {
              callbackId,
              callSid,
              streamSid,
              mediaFormat: data.start?.mediaFormat,
            },
            "Twilio media stream started",
          );
        }

        if (data?.event === "stop") {
          logger.info(
            {
              callbackId,
              callSid,
              streamSid,
              stopPayload: data.stop,
            },
            "Twilio media stream stop event",
          );
        }
      });

      session.on("guardrail_tripped", (event: any) => {
        logger.warn({ callbackId, event }, "Guardrail tripped");
      });

      session.on("error", (error: any) => {
        logger.error(
          { callbackId, callSid, streamSid, error },
          "Realtime session error",
        );
      });

      socket.on("error", (error) => {
        logger.error(
          { callbackId, callSid, streamSid, error },
          "Twilio websocket error",
        );
      });

      const onClose = async (reason: string, code?: number): Promise<void> => {
        if (isFinalized) {
          return;
        }
        isFinalized = true;

        try {
          const transcript = transcriptCollector.finalize();
          const duration = Math.round(transcript.duration / 1000);

          await processPostCall(transcript, {
            callSid,
            callbackId,
            duration,
          });

          await session.close();
          logger.info(
            {
              callbackId,
              callSid,
              streamSid,
              duration,
              closeReason: reason,
              closeCode: code,
            },
            "Media stream finalized",
          );
        } catch (error) {
          logger.error(
            {
              callbackId,
              callSid,
              streamSid,
              error,
              closeReason: reason,
              closeCode: code,
            },
            "Failed to finalize media stream session",
          );
        } finally {
          unregisterActiveCall(activeSessionId);
        }
      };

      session.on("closed", () => {
        void onClose("realtime_session_closed");
      });

      socket.on("close", (code, reasonBuffer) => {
        const reason = reasonBuffer.toString() || "websocket_closed";
        logger.info(
          { callbackId, callSid, streamSid, code, reason },
          "Twilio websocket closed",
        );
        void onClose(reason, code);
      });

      try {
        await session.connect({
          apiKey: config.OPENAI_API_KEY,
          model: config.OPENAI_REALTIME_MODEL,
          config: {
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
            },
          },
        } as any);
        sessionConnected = true;
        logger.info(
          { callbackId, callSid, streamSid },
          "Realtime session connected",
        );
        sendInitialGreetingIfReady();
      } catch (error) {
        logger.error(
          { callbackId, callSid, streamSid, error },
          "Failed to connect realtime session",
        );
        unregisterActiveCall(activeSessionId);
        socket.close();
      }
    },
  );
};
