import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { config } from "../config/env.js";
import { createRealtimeBridge } from "../llm/realtime-provider.js";
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
      let callSid = "unknown";
      let streamSid = "unknown";
      let isFinalized = false;
      let streamStarted = false;
      let sessionConnected = false;
      let greetingSent = false;

      const timingEnabled = config.TIMING_LOG;
      const expectedTwilioFrameMs = 20;
      const timingLogger = config.VERBOSE
        ? logger.info.bind(logger)
        : logger.warn.bind(logger);
      const eventLoopLag = monitorEventLoopDelay({ resolution: 20 });
      eventLoopLag.enable();

      let streamStartAtMs: number | null = null;
      let sessionConnectedAtMs: number | null = null;
      let greetingTriggeredAtMs: number | null = null;
      let firstAssistantAudioAtMs: number | null = null;
      let firstForwardToOpenAiAtMs: number | null = null;
      let firstOpenAiAudioEventAtMs: number | null = null;

      let lastTwilioMediaArrivalAtMs: number | null = null;
      let twilioMediaFrames = 0;
      let twilioJitterMsSum = 0;
      let twilioJitterMsMax = 0;
      let twilioIngressLagMsSum = 0;
      let twilioIngressLagMsMax = 0;
      let twilioIngressLagSamples = 0;

      let forwardToOpenAiMsSum = 0;
      let forwardToOpenAiMsMax = 0;
      let forwardToOpenAiSamples = 0;
      const pendingInboundMediaArrivalTimesMs: number[] = [];
      let localBufferingMsSum = 0;
      let localBufferingMsMax = 0;
      let localBufferingSamples = 0;

      let egressToTwilioMsSum = 0;
      let egressToTwilioMsMax = 0;
      let egressToTwilioSamples = 0;
      let firstEgressToTwilioMs: number | null = null;
      const pendingOpenAiAudioEventTimesMs: number[] = [];

      let outgoingAudioFramesSent = 0;
      let pendingOutgoingAudioFrames = 0;
      let outgoingDoneMarks = 0;

      const logTiming = (
        message: string,
        extra: Record<string, unknown>,
      ): void => {
        if (!timingEnabled) {
          return;
        }

        timingLogger(
          {
            callbackId,
            callSid,
            streamSid,
            metric: "timing",
            ...extra,
          },
          message,
        );
      };

      const snapshotTiming = (label: string): void => {
        if (!timingEnabled) {
          return;
        }

        const twilioJitterAvg =
          twilioMediaFrames > 1
            ? twilioJitterMsSum / (twilioMediaFrames - 1)
            : 0;
        const forwardAvg =
          forwardToOpenAiSamples > 0
            ? forwardToOpenAiMsSum / forwardToOpenAiSamples
            : 0;
        const localBufferingAvg =
          localBufferingSamples > 0
            ? localBufferingMsSum / localBufferingSamples
            : 0;
        const ingressLagAvg =
          twilioIngressLagSamples > 0
            ? twilioIngressLagMsSum / twilioIngressLagSamples
            : 0;
        const egressAvg =
          egressToTwilioSamples > 0
            ? egressToTwilioMsSum / egressToTwilioSamples
            : 0;

        logTiming("Call timing snapshot", {
          label,
          twilio_media_frames: twilioMediaFrames,
          twilio_media_jitter_avg_ms: Number(twilioJitterAvg.toFixed(2)),
          twilio_media_jitter_max_ms: Number(twilioJitterMsMax.toFixed(2)),
          twilio_ingress_lag_avg_ms: Number(ingressLagAvg.toFixed(2)),
          twilio_ingress_lag_max_ms: Number(twilioIngressLagMsMax.toFixed(2)),
          local_buffering_avg_ms: Number(localBufferingAvg.toFixed(2)),
          local_buffering_max_ms: Number(localBufferingMsMax.toFixed(2)),
          forward_to_openai_avg_ms: Number(forwardAvg.toFixed(2)),
          forward_to_openai_max_ms: Number(forwardToOpenAiMsMax.toFixed(2)),
          openai_roundtrip_first_ms:
            firstOpenAiAudioEventAtMs && firstForwardToOpenAiAtMs
              ? firstOpenAiAudioEventAtMs - firstForwardToOpenAiAtMs
              : null,
          egress_to_twilio_avg_ms: Number(egressAvg.toFixed(2)),
          egress_to_twilio_max_ms: Number(egressToTwilioMsMax.toFixed(2)),
          egress_to_twilio_first_ms: firstEgressToTwilioMs,
          first_forward_to_openai_ms_since_stream_start:
            firstForwardToOpenAiAtMs && streamStartAtMs
              ? firstForwardToOpenAiAtMs - streamStartAtMs
              : null,
          first_assistant_audio_ms_since_greeting:
            firstAssistantAudioAtMs && greetingTriggeredAtMs
              ? firstAssistantAudioAtMs - greetingTriggeredAtMs
              : null,
          first_assistant_audio_ms_since_session_connected:
            firstAssistantAudioAtMs && sessionConnectedAtMs
              ? firstAssistantAudioAtMs - sessionConnectedAtMs
              : null,
          outgoing_audio_frames_sent: outgoingAudioFramesSent,
          outgoing_done_marks: outgoingDoneMarks,
          outgoing_audio_queue_depth_frames: pendingOutgoingAudioFrames,
          outgoing_socket_buffered_bytes: socket.bufferedAmount,
          event_loop_lag_mean_ms: Number((eventLoopLag.mean / 1e6).toFixed(2)),
          event_loop_lag_max_ms: Number((eventLoopLag.max / 1e6).toFixed(2)),
          event_loop_lag_p99_ms: Number(
            (eventLoopLag.percentile(99) / 1e6).toFixed(2),
          ),
        });
      };

      const timingSnapshotInterval = timingEnabled
        ? setInterval(() => snapshotTiming("interval_5s"), 5_000)
        : null;
      timingSnapshotInterval?.unref();

      logger.info(
        { callbackId, activeSessionId },
        "Incoming Twilio media-stream websocket",
      );

      let bridge: ReturnType<typeof createRealtimeBridge>;
      try {
        bridge = createRealtimeBridge(socket);
      } catch (error) {
        logger.error(
          { callbackId, activeSessionId, error },
          "Failed to initialize realtime provider bridge",
        );
        unregisterActiveCall(activeSessionId);
        socket.close();
        return;
      }

      logger.info(
        {
          callbackId,
          activeSessionId,
          realtimeProvider: bridge.provider,
          realtimeModel: bridge.model,
        },
        "Initialized realtime provider bridge",
      );

      const transport = bridge.transport;
      if (transport) {
        const originalOnAudio = (transport as any)._onAudio?.bind(transport);
        if (typeof originalOnAudio === "function") {
          (transport as any)._onAudio = (audioEvent: any): void => {
            if (timingEnabled) {
              const now = Date.now();
              pendingOpenAiAudioEventTimesMs.push(now);
              if (firstOpenAiAudioEventAtMs === null) {
                firstOpenAiAudioEventAtMs = now;
              }
            }
            originalOnAudio(audioEvent);
          };
        }

        const originalSendEvent = transport.sendEvent.bind(transport);
        (transport as any).sendEvent = (event: any): void => {
          if (timingEnabled && event?.type === "input_audio_buffer.append") {
            const now = Date.now();
            const receivedAt = pendingInboundMediaArrivalTimesMs.shift();
            if (receivedAt) {
              const forwardMs = now - receivedAt;
              localBufferingSamples += 1;
              localBufferingMsSum += forwardMs;
              localBufferingMsMax = Math.max(localBufferingMsMax, forwardMs);
              forwardToOpenAiSamples += 1;
              forwardToOpenAiMsSum += forwardMs;
              forwardToOpenAiMsMax = Math.max(forwardToOpenAiMsMax, forwardMs);
              if (firstForwardToOpenAiAtMs === null) {
                firstForwardToOpenAiAtMs = now;
                logTiming("First audio frame forwarded to OpenAI", {
                  forward_to_openai_ms: forwardMs,
                });
              }
            }
          }

          originalSendEvent(event);
        };
      }

      const originalSocketSend = socket.send.bind(socket);
      (socket as any).send = (data: any, ...args: any[]): void => {
        if (timingEnabled) {
          try {
            const rawText = Buffer.isBuffer(data)
              ? data.toString("utf8")
              : String(data);
            const payload = JSON.parse(rawText);
            if (payload?.event === "media") {
              const beforeSendAtMs = Date.now();
              outgoingAudioFramesSent += 1;
              pendingOutgoingAudioFrames += 1;
              const openAiAudioAtMs = pendingOpenAiAudioEventTimesMs.shift();
              if (openAiAudioAtMs) {
                const egressDelayMs = beforeSendAtMs - openAiAudioAtMs;
                egressToTwilioSamples += 1;
                egressToTwilioMsSum += egressDelayMs;
                egressToTwilioMsMax = Math.max(
                  egressToTwilioMsMax,
                  egressDelayMs,
                );
                if (firstEgressToTwilioMs === null) {
                  firstEgressToTwilioMs = egressDelayMs;
                }
              }
              if (firstAssistantAudioAtMs === null) {
                firstAssistantAudioAtMs = beforeSendAtMs;
                logTiming("First assistant audio frame sent to Twilio", {
                  ms_since_greeting_trigger:
                    greetingTriggeredAtMs === null
                      ? null
                      : firstAssistantAudioAtMs - greetingTriggeredAtMs,
                  ms_since_session_connected:
                    sessionConnectedAtMs === null
                      ? null
                      : firstAssistantAudioAtMs - sessionConnectedAtMs,
                  openai_roundtrip_first_ms:
                    firstOpenAiAudioEventAtMs && firstForwardToOpenAiAtMs
                      ? firstOpenAiAudioEventAtMs - firstForwardToOpenAiAtMs
                      : null,
                  egress_to_twilio_first_ms: firstEgressToTwilioMs,
                });
              }
            }
          } catch {
            // Ignore non-JSON websocket output frames.
          }
        }

        originalSocketSend(data, ...args);
      };

      const session = bridge.session;
      session.on("provider_audio_chunk", () => {
        if (!timingEnabled) {
          return;
        }
        const now = Date.now();
        pendingOpenAiAudioEventTimesMs.push(now);
        if (firstOpenAiAudioEventAtMs === null) {
          firstOpenAiAudioEventAtMs = now;
        }
      });

      const sendInitialGreetingIfReady = (): void => {
        if (!sessionConnected || !streamStarted || greetingSent) {
          return;
        }

        greetingSent = true;
        greetingTriggeredAtMs = Date.now();
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
        if (streamStartAtMs === null) {
          streamStartAtMs = Date.now();
        }
        sendInitialGreetingIfReady();
      };

      transcriptCollector.attachToSession(session as any);

      socket.on("message", (raw) => {
        if (isFinalized) {
          return;
        }

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

          if (parsed?.event === "media") {
            const arrivalAtMs = Date.now();
            twilioMediaFrames += 1;
            pendingInboundMediaArrivalTimesMs.push(arrivalAtMs);
            if (pendingInboundMediaArrivalTimesMs.length > 500) {
              pendingInboundMediaArrivalTimesMs.shift();
            }

            if (lastTwilioMediaArrivalAtMs !== null) {
              const deltaMs = arrivalAtMs - lastTwilioMediaArrivalAtMs;
              const jitterMs = Math.abs(deltaMs - expectedTwilioFrameMs);
              twilioJitterMsSum += jitterMs;
              twilioJitterMsMax = Math.max(twilioJitterMsMax, jitterMs);
            }
            lastTwilioMediaArrivalAtMs = arrivalAtMs;

            const mediaTimestampMs = Number(parsed?.media?.timestamp);
            if (streamStartAtMs !== null && Number.isFinite(mediaTimestampMs)) {
              const ingressLagMs =
                arrivalAtMs - streamStartAtMs - mediaTimestampMs;
              twilioIngressLagSamples += 1;
              twilioIngressLagMsSum += ingressLagMs;
              twilioIngressLagMsMax = Math.max(
                twilioIngressLagMsMax,
                ingressLagMs,
              );
            }

            if (timingEnabled && twilioMediaFrames % 100 === 0) {
              snapshotTiming("every_100_media_frames");
            }
          }

          if (
            parsed?.event === "mark" &&
            typeof parsed?.mark?.name === "string"
          ) {
            if (parsed.mark.name.startsWith("done:")) {
              outgoingDoneMarks += 1;
              pendingOutgoingAudioFrames = Math.max(
                0,
                pendingOutgoingAudioFrames - 1,
              );
            }
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

          session.close();
          snapshotTiming("final");
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
          timingSnapshotInterval && clearInterval(timingSnapshotInterval);
          eventLoopLag.disable();
          if ((socket as any).readyState === 1) {
            socket.close();
          }
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
        await bridge.connect();
        sessionConnected = true;
        sessionConnectedAtMs = Date.now();
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
