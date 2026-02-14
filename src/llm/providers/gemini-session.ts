import { EventEmitter } from "node:events";
import type { WebSocket as FastifyWebSocket } from "@fastify/websocket";
import WebSocket from "ws";

import { config } from "../../config/env.js";
import {
  base64LittleEndianToPcm16,
  chunkInt16,
  decodeTwilioMuLawBase64ToPcm16,
  encodePcm16ToTwilioMuLawBase64,
  pcm16ToBase64LittleEndian,
  resamplePcm16Linear,
} from "../utils/audio.js";

interface GeminiSessionOptions {
  twilioWebSocket: FastifyWebSocket;
  apiKey: string;
  model: string;
  voiceName: string;
  instructions: string;
}

interface TwilioStartPayload {
  callSid?: string;
  streamSid?: string;
}

const TWILIO_SAMPLE_RATE = 8000;
const GEMINI_INPUT_SAMPLE_RATE = 16000;
const GEMINI_OUTPUT_SAMPLE_RATE = 24000;
const TWILIO_FRAME_SAMPLES = 160;

export class GeminiTwilioRealtimeSession extends EventEmitter {
  private readonly twilioWebSocket: FastifyWebSocket;

  private readonly apiKey: string;

  private readonly model: string;

  private readonly voiceName: string;

  private readonly instructions: string;

  private geminiWebSocket: WebSocket | null = null;

  private streamSid = "unknown";

  private callSid = "unknown";

  private connected = false;

  private closed = false;

  private setupComplete = false;

  private markCounter = 0;

  constructor(options: GeminiSessionOptions) {
    super();
    this.twilioWebSocket = options.twilioWebSocket;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.voiceName = options.voiceName;
    this.instructions = options.instructions;
    this.attachTwilioSocketHandlers();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const modelName = this.model.startsWith("models/")
      ? this.model
      : `models/${this.model}`;
    const wsUrl =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
    const url = `${wsUrl}?key=${encodeURIComponent(this.apiKey)}`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.geminiWebSocket = socket;
      let resolved = false;

      const setupTimeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error("Timed out waiting for Gemini setupComplete."));
        }
      }, 10000);

      const onResolve = (): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearTimeout(setupTimeout);
        resolve();
      };

      const onReject = (error: unknown): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        clearTimeout(setupTimeout);
        reject(error);
      };

      socket.on("open", () => {
        this.connected = true;
        this.sendGeminiEvent({
          setup: {
            model: modelName,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.voiceName,
                  },
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: this.instructions }],
            },
          },
        });
      });

      socket.on("message", (data) => {
        const parsed = this.parseJson(data.toString());
        if (!parsed) {
          return;
        }

        this.handleGeminiEvent(parsed);
        if (parsed.setupComplete && !this.setupComplete) {
          this.setupComplete = true;
          onResolve();
        }
      });

      socket.on("error", (error) => {
        this.emit("error", error);
        onReject(error);
      });

      socket.on("close", () => {
        this.connected = false;
        if (!this.closed) {
          this.closed = true;
          this.emit("closed");
        }
      });
    });
  }

  sendMessage(message: unknown): void {
    const text =
      typeof message === "string"
        ? message
        : typeof message === "object" && message
          ? JSON.stringify(message)
          : String(message ?? "");
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    this.sendGeminiEvent({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.connected = false;
    this.geminiWebSocket?.close();
    this.emit("closed");
  }

  private attachTwilioSocketHandlers(): void {
    this.twilioWebSocket.on("message", (raw) => {
      const payload = this.parseJson(raw.toString());
      if (!payload || typeof payload !== "object") {
        return;
      }

      if (payload.event === "start") {
        const start = payload.start as TwilioStartPayload | undefined;
        this.callSid = start?.callSid ?? this.callSid;
        this.streamSid = start?.streamSid ?? this.streamSid;
        this.emit("transport_event", { event: payload });
        return;
      }

      if (payload.event === "media") {
        const base64MuLaw = payload?.media?.payload;
        if (typeof base64MuLaw === "string" && base64MuLaw.length > 0) {
          this.forwardTwilioAudioToGemini(base64MuLaw);
        }
        return;
      }

      if (payload.event === "stop") {
        this.emit("transport_event", { event: payload });
        this.close();
      }
    });

    this.twilioWebSocket.on("close", () => {
      this.close();
    });
  }

  private forwardTwilioAudioToGemini(base64MuLaw: string): void {
    if (!this.connected || !this.geminiWebSocket || !this.setupComplete) {
      return;
    }

    const twilioPcm = decodeTwilioMuLawBase64ToPcm16(base64MuLaw);
    const geminiPcm = resamplePcm16Linear(
      twilioPcm,
      TWILIO_SAMPLE_RATE,
      GEMINI_INPUT_SAMPLE_RATE,
    );
    const base64GeminiPcm = pcm16ToBase64LittleEndian(geminiPcm);

    this.sendGeminiEvent({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64GeminiPcm,
          },
        ],
      },
    });
  }

  private handleGeminiEvent(payload: any): void {
    if (payload.error) {
      this.emit("error", payload.error);
      return;
    }

    const serverContent = payload?.serverContent;
    const inputTranscript = serverContent?.inputTranscription?.text;
    if (typeof inputTranscript === "string" && inputTranscript.trim()) {
      this.emit("conversation.item.input_audio_transcription.completed", {
        transcript: inputTranscript.trim(),
      });
    }

    const outputTranscript = serverContent?.outputTranscription?.text;
    if (typeof outputTranscript === "string" && outputTranscript.trim()) {
      this.emit("response.output_audio_transcript.done", {
        transcript: outputTranscript.trim(),
      });
    }

    const parts = serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const inline = part?.inlineData;
        if (
          inline &&
          typeof inline.data === "string" &&
          typeof inline.mimeType === "string" &&
          inline.mimeType.startsWith("audio/pcm")
        ) {
          this.forwardGeminiAudioToTwilio(inline.data);
        }
      }
    }

    if (serverContent?.interrupted && this.streamSid !== "unknown") {
      this.twilioWebSocket.send(
        JSON.stringify({
          event: "clear",
          streamSid: this.streamSid,
        }),
      );
    }
  }

  private forwardGeminiAudioToTwilio(base64Pcm16le: string): void {
    if (this.streamSid === "unknown") {
      return;
    }

    const pcm24k = base64LittleEndianToPcm16(base64Pcm16le);
    const pcm8k = resamplePcm16Linear(
      pcm24k,
      GEMINI_OUTPUT_SAMPLE_RATE,
      TWILIO_SAMPLE_RATE,
    );

    for (const chunk of chunkInt16(pcm8k, TWILIO_FRAME_SAMPLES)) {
      this.emit("provider_audio_chunk");
      const payload = encodePcm16ToTwilioMuLawBase64(chunk);
      this.twilioWebSocket.send(
        JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: { payload },
        }),
      );
      this.markCounter += 1;
      this.twilioWebSocket.send(
        JSON.stringify({
          event: "mark",
          streamSid: this.streamSid,
          mark: { name: `done:${this.markCounter}` },
        }),
      );
    }
  }

  private sendGeminiEvent(payload: object): void {
    if (!this.geminiWebSocket || this.geminiWebSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.geminiWebSocket.send(JSON.stringify(payload));
  }

  private parseJson(raw: string): any | null {
    try {
      return JSON.parse(raw);
    } catch (error) {
      if (config.VERBOSE) {
        this.emit("error", error);
      }
      return null;
    }
  }
}
