export interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

export interface TranscriptResult {
  callSid: string | null;
  duration: number;
  entries: TranscriptEntry[];
  fullText: string;
}

interface RealtimeSessionLike {
  on(event: string, listener: (event: any) => void): void;
}

export class TranscriptCollector {
  private readonly entries: TranscriptEntry[] = [];

  private callSid: string | null = null;

  private readonly startTime = Date.now();

  setCallSid(callSid: string): void {
    this.callSid = callSid;
  }

  attachToSession(session: RealtimeSessionLike): void {
    session.on("response.output_audio_transcript.done", (event: any) => {
      const text = event?.transcript ?? event?.text;
      if (typeof text === "string" && text.trim()) {
        this.addEntry("agent", text.trim());
      }
    });

    session.on("conversation.item.input_audio_transcription.completed", (event: any) => {
      const text = event?.transcript ?? event?.text;
      if (typeof text === "string" && text.trim()) {
        this.addEntry("user", text.trim());
      }
    });
  }

  addEntry(role: "user" | "agent", text: string): void {
    this.entries.push({
      role,
      text,
      timestamp: Date.now() - this.startTime
    });
  }

  finalize(): TranscriptResult {
    const duration = Date.now() - this.startTime;
    const fullText = this.entries
      .map((entry) => `[${entry.role === "agent" ? "Agent" : "User"}]: ${entry.text}`)
      .join("\n");

    return {
      callSid: this.callSid,
      duration,
      entries: [...this.entries],
      fullText
    };
  }
}
