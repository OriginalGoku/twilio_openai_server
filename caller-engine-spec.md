# Caller Engine — Technical Specification

## 1. Overview

A Node.js/TypeScript service hosted on Render that bridges outbound Twilio phone calls to OpenAI's Realtime API via the OpenAI Agents SDK. The service handles outbound call initiation, real-time bidirectional audio streaming, AI agent tool execution (Google Calendar, Gmail, SMS), transcript collection, and call lifecycle management.

This service is one component of a larger multi-tenant lead-capture platform. It receives "initiate call" requests from an upstream orchestrator (Trigger.dev) and reports results back via callbacks/webhooks.

---

## 2. Tech Stack

| Component            | Choice                                      |
| -------------------- | ------------------------------------------- |
| Runtime              | Node.js 20+ (LTS)                           |
| Language             | TypeScript 5.x (strict mode)                |
| HTTP/WS Server       | Fastify 5.x + @fastify/websocket            |
| OpenAI Integration   | @openai/agents + @openai/agents-extensions   |
| Telephony            | twilio SDK 5.x                               |
| Validation           | zod 4.x                                      |
| Logging              | pino 9.x                                     |
| Environment          | dotenv 16.x                                  |
| Google APIs          | googleapis (Calendar + Gmail)                |
| Deployment           | Render (paid Starter tier, Dockerfile)       |

---

## 3. Project Structure

```
caller-engine/
├── src/
│   ├── server.ts
│   ├── config/
│   │   └── env.ts
│   ├── agents/
│   │   ├── factory.ts
│   │   ├── prompts.ts
│   │   └── tools/
│   │       ├── index.ts
│   │       ├── schedule-meeting.ts
│   │       ├── check-availability.ts
│   │       ├── send-sms.ts
│   │       └── send-email.ts
│   ├── telephony/
│   │   ├── outbound-call.ts
│   │   ├── media-stream.ts
│   │   ├── twiml.ts
│   │   └── status-callback.ts
│   ├── transcription/
│   │   ├── collector.ts
│   │   └── post-call.ts
│   ├── routes/
│   │   ├── call.routes.ts
│   │   ├── twiml.routes.ts
│   │   ├── webhook.routes.ts
│   │   └── health.routes.ts
│   └── utils/
│       ├── logger.ts
│       └── graceful-shutdown.ts
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── .env.example
```

---

## 4. File-by-File Specification

---

### 4.1 `src/server.ts` — Application Entry Point

**Purpose:** Initialize Fastify, register plugins, mount all routes, and start the HTTP/WebSocket server with graceful shutdown support.

**Responsibilities:**

- Create a Fastify instance with the pino logger instance from `utils/logger.ts`.
- Register `@fastify/formbody` (Twilio sends `application/x-www-form-urlencoded` for webhooks).
- Register `@fastify/websocket` (required for the `/media-stream` WebSocket route).
- Import and register all route modules from `routes/`.
- Import and invoke the graceful shutdown handler from `utils/graceful-shutdown.ts`.
- Read the `PORT` from the validated env config (default `5050`).
- Bind to `0.0.0.0` (required by Render — Fastify defaults to `127.0.0.1`).
- Log a startup message with the port number and environment.

**Key Detail — Host Binding:**
Render requires binding to `0.0.0.0`, not localhost. Fastify's `listen()` must explicitly set `host: "0.0.0.0"`.

---

### 4.2 `src/config/env.ts` — Environment Variable Validation

**Purpose:** Validate and export all environment variables at startup using zod. Fail fast with a clear error if any required variable is missing.

**Schema to validate:**

| Variable                   | Required | Default                | Description                                |
| -------------------------- | -------- | ---------------------- | ------------------------------------------ |
| `PORT`                     | No       | `5050`                 | Server port                                |
| `NODE_ENV`                 | No       | `development`          | Environment identifier                     |
| `BASE_URL`                 | Yes      | —                      | Public HTTPS URL of this service on Render |
| `OPENAI_API_KEY`           | Yes      | —                      | OpenAI API key                             |
| `OPENAI_REALTIME_MODEL`    | No       | `gpt-realtime`         | Realtime model identifier                  |
| `OPENAI_VOICE`             | No       | `marin`                | Voice for the AI agent                     |
| `TWILIO_ACCOUNT_SID`       | Yes      | —                      | Twilio Account SID                         |
| `TWILIO_AUTH_TOKEN`        | Yes      | —                      | Twilio Auth Token                          |
| `TWILIO_PHONE_NUMBER`      | Yes      | —                      | Twilio phone number (E.164)                |
| `GOOGLE_CLIENT_EMAIL`      | Yes*     | —                      | Google service account email               |
| `GOOGLE_PRIVATE_KEY`       | Yes*     | —                      | Google service account private key          |
| `GOOGLE_CALENDAR_ID`       | Yes*     | —                      | Target Google Calendar ID                  |
| `CALL_TIME_LIMIT`          | No       | `300`                  | Max call duration in seconds               |
| `SYSTEM_PROMPT`            | No       | (from `prompts.ts`)    | Override system prompt                     |

*Required only if calendar/email tools are enabled.

**Export:** A single typed `config` object that all other modules import. The zod schema should use `.transform()` to coerce `PORT` and `CALL_TIME_LIMIT` to numbers, and to strip trailing slashes from `BASE_URL`.

**Helper Function:** Include a `toWsUrl(httpUrl: string, path: string): string` utility that converts the `BASE_URL` from `https://` to `wss://` (or `http://` to `ws://`) and appends the path. This replaces the `to_ws_url` function from the original Python code.

---

### 4.3 `src/agents/factory.ts` — Agent Factory

**Purpose:** Construct a `RealtimeAgent` instance configured for a specific client/call context. In the initial single-tenant version, this reads from environment variables. The multi-tenant version will accept a client config object.

**Responsibilities:**

- Import `RealtimeAgent` from `@openai/agents/realtime`.
- Import all tool definitions from `tools/index.ts`.
- Import the system prompt from `prompts.ts` (or use the env override).
- Export a `createAgent(options?)` function that returns a configured `RealtimeAgent`.

**Agent Configuration:**

```
RealtimeAgent({
  name: "ClientAgent",
  model: config.OPENAI_REALTIME_MODEL,
  instructions: <system prompt>,
  voice: config.OPENAI_VOICE,
  tools: [scheduleMeetingTool, checkAvailabilityTool, sendSmsTool, ...],
})
```

**Key Design Notes:**

- The `instructions` field should include explicit guidance for the agent to greet the caller when the session begins. This ensures the AI generates the first audio the user hears — no Twilio TTS involved. The greeting behavior is: *"When the call connects, greet the caller briefly and ask what they need help with."*
- Tools are registered declaratively. The Agents SDK handles the full function_call → execute → function_call_output → response.create cycle automatically. No manual dispatch needed (unlike the original Python `handle_tool_call` / `TOOL_DISPATCH` pattern).
- For multi-tenant: this function will later accept a `ClientConfig` parameter containing tenant-specific instructions, voice, and enabled tools. For now, everything comes from env.

---

### 4.4 `src/agents/prompts.ts` — System Prompt Templates

**Purpose:** Store and export system prompt strings. Provides a default prompt and a mechanism to customize per client type.

**Contents:**

- Export a `DEFAULT_PROMPT` string constant containing a general-purpose phone assistant prompt. This should be similar in structure to the existing Python system prompt: define a primary goal (help with appointments), secondary goal (answer business questions), calendar capabilities (working hours, default duration), style constraints (2 sentences max, direct, action-oriented), and post-call actions (send SMS confirmation).
- Export a `buildPrompt(overrides: { businessName?, businessType?, workingHours?, services? }): string` function that interpolates client-specific values into the prompt template. This supports multi-tenancy without hardcoding.
- The prompt should instruct the agent to speak first when the call begins — this replaces the explicit `response.create` greeting from the Python code. The Agents SDK with Server VAD enabled will trigger the agent to speak when it detects the session start and no incoming audio.

---

### 4.5 `src/agents/tools/index.ts` — Tool Registry

**Purpose:** Central export of all tool definitions. Each tool is defined using the Agents SDK's `tool()` function with a zod schema for parameters.

**Responsibilities:**

- Import each individual tool from its file.
- Export them as an array: `export const agentTools = [scheduleMeetingTool, checkAvailabilityTool, sendSmsTool, sendEmailTool]`.

**How SDK Tools Work (versus the Python code):**

In the original Python code, tools were defined as JSON schemas in a `TOOLS` list and dispatched manually via a `TOOL_DISPATCH` dictionary. The `handle_tool_call` function received `response.done` events, extracted `function_call` items, looked up the function, called it, sent `function_call_output`, then triggered a new `response.create`.

With the Agents SDK, all of this is automatic:

```
tool({
  name: "tool_name",
  description: "...",
  parameters: z.object({ ... }),
  execute: async (input) => { ... return result; },
})
```

The SDK intercepts function_call events, calls `execute`, sends the output, and triggers the agent to resume speaking. No manual round-trip management needed.

---

### 4.6 `src/agents/tools/schedule-meeting.ts` — Schedule Meeting Tool

**Purpose:** Create a Google Calendar event for a caller's appointment.

**Tool Definition:**

- **Name:** `schedule_meeting`
- **Description:** "Schedule a meeting or appointment on the calendar. Use this when the caller wants to book a new appointment."
- **Parameters (zod schema):**
  - `date` (string, required) — ISO 8601 date string, e.g. "2025-03-15"
  - `time` (string, required) — Time in HH:MM format (24h), e.g. "14:30"
  - `name` (string, required) — Caller's name
  - `phone` (string, optional) — Caller's phone number
- **Execute function:**
  - Validate that the requested time falls within working hours (configurable, default 9:00–20:00 Mon–Sat). If outside hours, return an error message (the agent will relay this to the caller).
  - Calculate `startTime` from date + time in the business timezone.
  - Calculate `endTime` as startTime + 30 minutes (default duration, matching the Python prompt's "Default: 30 minutes, no description").
  - Use the Google Calendar API (`googleapis`) to insert an event:
    - `calendarId`: from config
    - `summary`: `"Appointment - {name}"`
    - `start`/`end`: with `dateTime` and `timeZone`
    - `description`: minimal (caller phone if provided)
  - Return a success object: `{ status: "confirmed", eventId, startTime, endTime }`.
  - On error, return `{ error: "..." }` — the SDK will pass this to the agent who will communicate it to the caller.

**Google Auth:**
Use a service account with a JSON key (client_email + private_key from env). Create the auth client once at module level using `google.auth.getClient()` with calendar scope. Do not create a new auth client per call.

---

### 4.7 `src/agents/tools/check-availability.ts` — Check Calendar Availability

**Purpose:** Query available time slots for a given date.

**Tool Definition:**

- **Name:** `check_availability`
- **Description:** "Check available appointment slots for a specific date. Use this when the caller asks when they can book."
- **Parameters:**
  - `date` (string, required) — ISO 8601 date
- **Execute function:**
  - Query Google Calendar's `freebusy` API for the given date (business hours only).
  - Compute available 30-minute slots within working hours that don't overlap with existing events.
  - Return `{ date, availableSlots: ["09:00", "09:30", "10:00", ...] }`.
  - If no slots, return `{ date, availableSlots: [], message: "No availability on this date" }`.

---

### 4.8 `src/agents/tools/send-sms.ts` — Send SMS Tool

**Purpose:** Send an SMS to the caller (e.g., appointment confirmation with meeting details).

**Tool Definition:**

- **Name:** `send_sms`
- **Description:** "Send an SMS message to a phone number. Use this to send appointment confirmations or meeting links."
- **Parameters:**
  - `to` (string, required) — Phone number in E.164 format
  - `message` (string, required) — SMS body text
- **Execute function:**
  - Use the Twilio SDK to send an SMS from `config.TWILIO_PHONE_NUMBER` to the `to` number.
  - Return `{ status: "sent", messageSid: "..." }`.
  - On error, return `{ error: "..." }`.

**Important:** This tool is invoked by the AI agent during the call. The agent decides when to send an SMS based on the conversation flow (e.g., after booking, the prompt tells it to "send them an SMS about the meeting time and the link"). The phone number may come from the caller during the conversation or from the call initiation context.

---

### 4.9 `src/agents/tools/send-email.ts` — Send Email Tool

**Purpose:** Send an email via Gmail (e.g., appointment confirmation, follow-up).

**Tool Definition:**

- **Name:** `send_email`
- **Description:** "Send an email to a specified address. Use this to send appointment confirmations or follow-up information."
- **Parameters:**
  - `to` (string, required) — Recipient email address
  - `subject` (string, required) — Email subject line
  - `body` (string, required) — Email body (plain text)
- **Execute function:**
  - Use the Gmail API (`googleapis`) with the same service account (or delegated credentials) to send a message.
  - Construct the raw RFC 2822 message, base64url-encode it, and call `gmail.users.messages.send`.
  - Return `{ status: "sent", messageId: "..." }`.

**Note:** Gmail API with service accounts requires domain-wide delegation if sending as a user. For the initial version, this can be implemented but marked as optional in config — not every client will need email during calls.

---

### 4.10 `src/telephony/outbound-call.ts` — Outbound Call Initiator

**Purpose:** Use the Twilio REST API to create an outbound phone call that connects to the media stream WebSocket.

**Exported Function:** `initiateOutboundCall(params): Promise<CallResult>`

**Parameters:**

```typescript
interface OutboundCallParams {
  to: string;            // E.164 phone number to call
  callbackId: string;    // Unique identifier for this call (submission_id from DB)
  record: boolean;       // Whether to enable Twilio call recording
}
```

**Implementation:**

- Instantiate the Twilio client with `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`.
- Call `client.calls.create()` with:
  - `to`: the user's phone number
  - `from`: `config.TWILIO_PHONE_NUMBER`
  - `url`: `${config.BASE_URL}/twiml/outbound?callbackId=${callbackId}` — the TwiML endpoint
  - `statusCallback`: `${config.BASE_URL}/webhooks/call-status` — lifecycle events
  - `statusCallbackEvent`: `["initiated", "ringing", "answered", "completed"]`
  - `statusCallbackMethod`: `POST`
  - `timeLimit`: `config.CALL_TIME_LIMIT` (default 300 = 5 min)
  - `record`: `params.record`
  - `machineDetection`: `"Enable"` — optional, to detect voicemail and handle gracefully
- Return `{ callSid, status }`.
- On error, throw a typed error that the caller (Trigger.dev step) can handle.

**Key Design Note:** The `callbackId` is passed as a query parameter to the TwiML URL so that when Twilio fetches TwiML, the server knows which client config to load for this particular call. This is the tenant resolution mechanism during the call flow.

---

### 4.11 `src/telephony/twiml.ts` — TwiML Generator

**Purpose:** Return TwiML XML that tells Twilio to open a bidirectional Media Stream WebSocket. No `<Say>` — the AI generates all audio including the greeting.

**Route:** `POST /twiml/outbound` or `GET /twiml/outbound`

**Implementation:**

- Extract `callbackId` from query parameters.
- Construct the WebSocket URL: `wss://${request.headers.host}/media-stream?callbackId=${callbackId}`.
- Return TwiML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://your-host/media-stream?callbackId=abc123" />
  </Connect>
</Response>
```

- Set `Content-Type: text/xml`.

**Why no `<Say>`:** The greeting is generated by the OpenAI Realtime agent. This means the first thing the user hears is the AI voice, maintaining consistent voice/personality from the very start. This exactly matches the behavior of the original Python code where `_send_initial_greeting()` was called after `session.update`, not Twilio's TTS.

**Important:** The `callbackId` is forwarded as a query parameter on the WebSocket URL so the media-stream handler can look up the correct agent configuration for this call.

---

### 4.12 `src/telephony/media-stream.ts` — WebSocket Audio Bridge

**Purpose:** The core of the caller engine. Handles the bidirectional audio bridge between Twilio's Media Stream and OpenAI's Realtime API via the `TwilioRealtimeTransportLayer`.

**Route:** `GET /media-stream` (WebSocket upgrade)

**This is the file that replaces the entire `twilio_media` WebSocket handler, `AudioBridgeTranscoder`, `OpenAIRealtimeClient`, and the `twilio_to_openai` / `openai_to_twilio` task pair from the original Python code.**

**Implementation:**

1. **On WebSocket connection:**
   - Extract `callbackId` from the query string.
   - Load the agent configuration for this call (via `factory.ts`). In multi-tenant mode, this resolves the client config from the database using `callbackId`.
   - Create the `RealtimeAgent` using the factory.
   - Create a `TwilioRealtimeTransportLayer` instance, passing the raw Twilio WebSocket connection.
   - Create a `RealtimeSession` with the agent and transport.
   - Create a `TranscriptCollector` instance (from `transcription/collector.ts`) and attach it to the session's events.
   - Call `session.connect({ apiKey: config.OPENAI_API_KEY })`.
   - Log the connection.

2. **Audio pipeline (automatic):**
   - The `TwilioRealtimeTransportLayer` handles all audio format negotiation. It automatically:
     - Sets `input_audio_format: "g711_ulaw"` and `output_audio_format: "g711_ulaw"` on the OpenAI session.
     - Forwards Twilio media events to OpenAI.
     - Forwards OpenAI audio deltas back to Twilio.
     - Handles interruption detection via Twilio's mark events (sends `clear` to Twilio and `response.cancel` to OpenAI when the user starts speaking).
   - **No manual transcoding is needed.** The entire `AudioBridgeTranscoder` class from the Python code is eliminated. There is no μ-law ↔ PCM conversion, no `audioop`, no resampling.

3. **Tool execution (automatic):**
   - Tools are defined on the `RealtimeAgent`. When OpenAI sends a function_call, the SDK automatically:
     - Parses the arguments.
     - Calls the tool's `execute` function.
     - Sends `function_call_output` back to OpenAI.
     - Triggers a new response so the agent speaks the result.
   - **No manual `handle_tool_call` dispatch is needed.** The entire tool dispatch system from the Python code is eliminated.

4. **Event listeners to attach:**
   - `session.on("transport_event", ...)` — Listen for raw Twilio events. On the `start` event, extract `callSid` and `streamSid` for logging and state tracking.
   - `session.on("guardrail_tripped", ...)` — Optional. Log if an output guardrail fires.
   - `session.on("error", ...)` — Log errors. If the error is fatal (e.g., WebSocket closed unexpectedly), clean up.
   - `session.on("closed", ...)` — Trigger post-call processing (transcript finalization).
   - Transcript-related events: delegate to the `TranscriptCollector` (see section 4.15).

5. **Cleanup on disconnect:**
   - When either side disconnects (Twilio sends `stop` event, or OpenAI WebSocket closes):
     - Finalize the transcript collector.
     - Call `session.close()` to clean up both WebSocket connections.
     - Log the call end with duration if available.
     - Trigger post-call processing (async, does not block the WebSocket close).

**Error Handling:**

- Wrap the entire handler in try/catch. If `session.connect()` fails (e.g., OpenAI is down), close the Twilio WebSocket immediately — Twilio will end the call.
- If the OpenAI WebSocket drops mid-call, the transport layer should handle reconnection or the session will emit an error. Log it, close the Twilio side gracefully.
- Do not let unhandled promise rejections crash the process.

---

### 4.13 `src/telephony/status-callback.ts` — Call Status Webhook Handler

**Purpose:** Receive Twilio call status callback events and log/update call state.

**Route:** `POST /webhooks/call-status`

**Twilio POST body fields (form-urlencoded):**

- `CallSid` — Unique call identifier
- `CallStatus` — `initiated`, `ringing`, `answered`, `completed`, `busy`, `no-answer`, `failed`, `canceled`
- `CallDuration` — Duration in seconds (on `completed`)
- `RecordingUrl` — URL of the recording (if recording was enabled)
- `RecordingSid` — Recording identifier

**Implementation:**

- Parse the form body (handled by `@fastify/formbody`).
- Log every status transition with the `CallSid` and timestamp.
- On `completed`:
  - Log the `CallDuration`.
  - If `RecordingUrl` is present, log/store the recording URL and `RecordingSid`.
  - This is where post-call metadata is captured for the upstream system (Trigger.dev / DB).
- On `busy`, `no-answer`, `failed`, `canceled`:
  - Log the failure state.
  - This information will be reported back to the orchestrator for DB update and client notification.
- Return `200 OK` with empty body (Twilio expects this).

**Future Enhancement:** In the multi-tenant version, this handler will write status updates to the Render Postgres database and emit events to Trigger.dev for workflow continuation.

---

### 4.14 `src/transcription/collector.ts` — Transcript Collector

**Purpose:** Accumulate transcript text from OpenAI Realtime session events during a live call. Produces a structured transcript with speaker labels and timestamps.

**Class: `TranscriptCollector`**

**Internal state:**

- `entries: Array<{ role: "user" | "agent", text: string, timestamp: number }>` — Ordered list of transcript entries.
- `callSid: string | null` — Set when the call starts.
- `startTime: number` — Timestamp when collection began.

**How transcripts are captured with the Agents SDK:**

The OpenAI Realtime API provides transcript data through several event types. The `RealtimeSession` emits these as events that can be listened to:

- **Agent output transcript:** The `response.output_audio_transcript.delta` and `response.output_audio_transcript.done` events contain the text of what the agent is saying. Listen for the `.done` event and append the full transcript text with `role: "agent"`.
- **User input transcript:** If `input_audio_transcription` is enabled in the session config, OpenAI asynchronously transcribes the user's audio. The `conversation.item.input_audio_transcription.completed` event contains the user's speech as text. Append with `role: "user"`.

**Methods:**

- `attachToSession(session: RealtimeSession)` — Register event listeners on the session for transcript events. This is called in `media-stream.ts` after creating the session.
- `addEntry(role, text)` — Append a transcript entry with the current timestamp offset.
- `finalize(): TranscriptResult` — Return the complete structured transcript.
  - `TranscriptResult`: `{ callSid, duration, entries[], fullText: string }`
  - `fullText` is the concatenated transcript with speaker labels, e.g.:
    ```
    [Agent]: Hello! How can I help you today?
    [User]: I'd like to book an appointment for next Tuesday.
    [Agent]: Let me check availability for next Tuesday...
    ```

**Enabling input transcription:**

The session configuration should include `input_audio_transcription` to get user-side transcripts. With the Agents SDK, this can be set in the session update or agent config. This is important — without it, you only get the agent's side of the conversation.

---

### 4.15 `src/transcription/post-call.ts` — Post-Call Processing

**Purpose:** After a call ends, process the transcript and prepare it for upstream storage (HubSpot, database).

**Exported Function:** `processPostCall(transcript: TranscriptResult, callMetadata: CallMetadata): Promise<PostCallResult>`

**Parameters:**

- `transcript` — from `TranscriptCollector.finalize()`
- `callMetadata` — `{ callSid, callbackId, duration, recordingUrl?, recordingSid? }`

**Implementation:**

1. **Store raw transcript:** Package the full transcript text and structured entries. In the current version, this returns the data. In the multi-tenant version, this writes to the database.

2. **Generate LLM summary (optional, async):** Call the OpenAI Chat Completions API (not the Realtime API) with the transcript text and a prompt like:
   ```
   Summarize this phone call transcript. Extract:
   - intent (what the caller wanted)
   - outcome (what happened)
   - next_action (any follow-up needed)
   - scheduled_date (if an appointment was booked, ISO format)
   - sentiment (positive/neutral/negative)
   Return as JSON.
   ```
   Use a cheap model (gpt-4o-mini). This adds ~1-2 seconds and ~$0.01 per call.

3. **Return `PostCallResult`:**
   ```typescript
   interface PostCallResult {
     callSid: string;
     callbackId: string;
     transcript: string;           // Full text
     summary?: string;             // LLM-generated summary
     structuredData?: {
       intent: string;
       outcome: string;
       nextAction: string;
       scheduledDate?: string;
       sentiment: string;
     };
     recordingUrl?: string;
     duration: number;
   }
   ```

**Future Enhancement:** This function will write to Render Postgres and trigger HubSpot API calls (upload transcript as file attachment, create Note with summary). For now, it logs the result and returns it.

---

### 4.16 `src/routes/call.routes.ts` — Call Initiation Route

**Purpose:** Expose the API endpoint that triggers an outbound call. Called by the upstream orchestrator (Trigger.dev workflow step).

**Route:** `POST /call/initiate`

**Request Body (JSON):**

```typescript
{
  callbackId: string;     // submission_id from the platform
  to: string;             // E.164 phone number
  record: boolean;        // Whether to record the call
  // Future multi-tenant fields:
  // clientId: string;
  // agentConfig?: { instructions?, voice?, tools? }
}
```

**Implementation:**

- Validate the request body with zod.
- Call `initiateOutboundCall()` from `telephony/outbound-call.ts`.
- Return `{ success: true, callSid: "..." }` on success.
- Return `{ success: false, error: "..." }` on failure.

**Authentication:** For now, this endpoint is open (Render's network isolation provides some protection). In production, add a shared secret header (`X-API-Key`) validated against an env variable. Trigger.dev will include this header in its HTTP step.

---

### 4.17 `src/routes/twiml.routes.ts` — TwiML Route

**Purpose:** Mount the TwiML endpoint that Twilio fetches when the outbound call connects.

**Route:** `POST /twiml/outbound` and `GET /twiml/outbound` (Twilio may use either method)

**Implementation:**

- Import the TwiML generator from `telephony/twiml.ts`.
- Register it as a Fastify route using `fastify.all("/twiml/outbound", handler)`.
- The handler extracts `callbackId` from query params and returns the `<Response><Connect><Stream>` TwiML.

---

### 4.18 `src/routes/webhook.routes.ts` — Webhook Routes

**Purpose:** Mount Twilio webhook endpoints for call status callbacks.

**Routes:**

- `POST /webhooks/call-status` — Delegates to `telephony/status-callback.ts`.

**Implementation:**

- Import the status callback handler.
- Register it as a Fastify POST route.
- Twilio sends form-urlencoded data; `@fastify/formbody` parses it.

**Future Addition:** Twilio inbound SMS webhook will also be mounted here for the SMS verification flow. That is a separate feature not in scope for the caller engine module.

---

### 4.19 `src/routes/health.routes.ts` — Health Check

**Purpose:** Simple health check for Render's monitoring and upstream health probes.

**Route:** `GET /health`

**Response:** `{ status: "ok", timestamp: <ISO string>, uptime: <seconds> }`

---

### 4.20 `src/utils/logger.ts` — Structured Logger

**Purpose:** Create and export a configured pino logger instance used across all modules.

**Configuration:**

- In development: `pino-pretty` transport for human-readable logs.
- In production: JSON output (pino's default), suitable for log aggregation.
- Base fields: `{ service: "caller-engine", env: config.NODE_ENV }`.
- Log level: `info` in production, `debug` in development.

**Usage:** All modules import `logger` from this file rather than creating their own. This ensures consistent formatting and field inclusion.

---

### 4.21 `src/utils/graceful-shutdown.ts` — Graceful Shutdown Handler

**Purpose:** Handle `SIGTERM` (sent by Render during deploys) by draining active calls before shutting down.

**Implementation:**

- Maintain a `Set<string>` of active call session IDs (added when a media-stream WebSocket opens, removed when it closes).
- On `SIGTERM`:
  - Log "Shutdown signal received, draining N active calls".
  - Stop accepting new connections (Fastify's `.close()` method).
  - Wait for all active calls to complete, with a maximum timeout (e.g., 280 seconds, leaving 20 seconds of Render's 300-second budget for cleanup).
  - If timeout is reached, force-close remaining sessions.
  - Exit the process.
- Export functions: `registerActiveCall(id)`, `unregisterActiveCall(id)`, `setupGracefulShutdown(fastify)`.

---

### 4.22 `package.json`

**Key fields:**

```json
{
  "name": "caller-engine",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openai/agents": "latest",
    "@openai/agents-extensions": "latest",
    "fastify": "^5",
    "@fastify/formbody": "^8",
    "@fastify/websocket": "^11",
    "twilio": "^5",
    "googleapis": "^140",
    "openai": "^4",
    "zod": "^4",
    "pino": "^9",
    "dotenv": "^16"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "tsx": "^4",
    "pino-pretty": "^11",
    "@types/node": "^20"
  }
}
```

**Notes:**

- `"type": "module"` — Use ES modules (matches Agents SDK examples).
- `tsx` for development (TypeScript execution without build step).
- `openai` package is a peer dependency of `@openai/agents` but should be explicitly listed.
- `googleapis` is used for both Calendar and Gmail tools.

---

### 4.23 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### 4.24 `Dockerfile`

**Purpose:** Production container for deployment on Render.

**Strategy:**

- Multi-stage build: build stage (install deps + compile TS) → production stage (copy dist + node_modules).
- Base image: `node:20-slim`.
- Build stage:
  - `WORKDIR /app`
  - Copy `package.json` and `package-lock.json` (or `pnpm-lock.yaml`).
  - `npm ci` (install all deps including devDependencies for build).
  - Copy `src/` and `tsconfig.json`.
  - `npm run build` (compiles TypeScript to `dist/`).
- Production stage:
  - `WORKDIR /app`
  - Copy `package.json` and `package-lock.json`.
  - `npm ci --omit=dev` (production deps only).
  - Copy `dist/` from build stage.
  - `EXPOSE 5050`
  - `CMD ["node", "dist/server.js"]`

**Render Config:** In the Render dashboard, set the service type to "Web Service", point to this Dockerfile, and set environment variables. Render auto-detects the Dockerfile.

---

### 4.25 `.env.example`

```
# Server
PORT=5050
NODE_ENV=development
BASE_URL=https://your-app.onrender.com

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_VOICE=marin

# Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Google (for Calendar + Gmail tools)
GOOGLE_CLIENT_EMAIL=...@...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=primary

# Call settings
CALL_TIME_LIMIT=300

# Optional: Override system prompt
# SYSTEM_PROMPT="You are..."
```

---

## 5. Audio Pipeline Summary

```
┌─────────────┐       g711_ulaw 8kHz        ┌─────────────────────────────┐
│   Twilio     │ ◄─────────────────────────► │  TwilioRealtimeTransport    │
│ Media Stream │       (bidirectional)       │        Layer                │
└─────────────┘                              └──────────────┬──────────────┘
                                                            │
                                              g711_ulaw passthrough
                                              (no resampling)
                                                            │
                                             ┌──────────────▼──────────────┐
                                             │   OpenAI Realtime API       │
                                             │   (gpt-realtime model)      │
                                             │                             │
                                             │   input_audio_format:       │
                                             │     g711_ulaw               │
                                             │   output_audio_format:      │
                                             │     g711_ulaw               │
                                             └─────────────────────────────┘
```

**What was eliminated from the Python code:**
- `AudioBridgeTranscoder` class — no μ-law decode / PCM resample / μ-law encode
- `audioop` / `audioop-lts` dependency
- Manual `ratecv` state management for streaming resampling
- All base64 encode/decode between audio format stages

---

## 6. Call Sequence Diagram

```
Trigger.dev                    Caller Engine                 Twilio                   OpenAI Realtime
    │                              │                           │                           │
    │  POST /call/initiate         │                           │                           │
    │─────────────────────────────►│                           │                           │
    │                              │  calls.create(to, url)    │                           │
    │                              │──────────────────────────►│                           │
    │                              │                           │  Dials user's phone       │
    │                              │                           │──────────►                │
    │  { callSid }                 │                           │                           │
    │◄─────────────────────────────│                           │                           │
    │                              │                           │  User answers             │
    │                              │  GET /twiml/outbound      │◄──────────               │
    │                              │◄──────────────────────────│                           │
    │                              │  <Connect><Stream>        │                           │
    │                              │──────────────────────────►│                           │
    │                              │                           │                           │
    │                              │  WS /media-stream         │                           │
    │                              │◄══════════════════════════│                           │
    │                              │                           │                           │
    │                              │  session.connect()        │                           │
    │                              │═══════════════════════════════════════════════════════►│
    │                              │                           │                           │
    │                              │                           │  Agent auto-greets        │
    │                              │  audio delta (g711_ulaw)  │◄══════════════════════════│
    │                              │══════════════════════════►│                           │
    │                              │                           │  ──► User hears greeting  │
    │                              │                           │                           │
    │                              │     ... bidirectional audio continues ...              │
    │                              │                           │                           │
    │                              │                           │  function_call:           │
    │                              │  SDK auto-executes tool   │  schedule_meeting         │
    │                              │◄══════════════════════════════════════════════════════│
    │                              │  (Google Calendar API)    │                           │
    │                              │  function_call_output     │                           │
    │                              │═══════════════════════════════════════════════════════►│
    │                              │                           │                           │
    │                              │                           │  Agent speaks result      │
    │                              │  audio delta              │◄══════════════════════════│
    │                              │══════════════════════════►│  ──► User hears result    │
    │                              │                           │                           │
    │                              │           ... call continues or ends ...               │
    │                              │                           │                           │
    │                              │  Twilio: stop event       │                           │
    │                              │◄══════════════════════════│                           │
    │                              │  session.close()          │                           │
    │                              │═══════════════════════════════════════════════════════►│
    │                              │                           │                           │
    │                              │  POST /webhooks/call-status (completed)               │
    │                              │◄──────────────────────────│                           │
    │                              │                           │                           │
    │                              │  Finalize transcript      │                           │
    │                              │  Generate LLM summary     │                           │
    │                              │                           │                           │
```

---

## 7. What the Agents SDK Eliminates

| Original Python Code               | Lines  | New TypeScript Equivalent                         |
| ----------------------------------- | ------ | ------------------------------------------------- |
| `AudioBridgeTranscoder` class       | ~30    | **Eliminated** — transport handles g711_ulaw      |
| `OpenAIRealtimeClient` class        | ~60    | **Eliminated** — `RealtimeSession` manages WS     |
| `twilio_to_openai()` async task     | ~30    | **Eliminated** — transport reads Twilio WS        |
| `openai_to_twilio()` async task     | ~60    | **Eliminated** — transport writes to Twilio WS    |
| `handle_tool_call()` dispatch       | ~50    | **Eliminated** — SDK `tool()` auto-dispatches     |
| Manual `response.cancel` tracking   | ~15    | **Eliminated** — transport handles interruptions  |
| Manual `response_active` flag       | ~10    | **Eliminated** — SDK tracks response state        |
| `audioop` / resampling logic        | ~10    | **Eliminated** — no format conversion needed      |
| **Total eliminated**                | **~265** | Replaced by ~60 lines in `media-stream.ts`      |

---

## 8. Configuration for Multi-Tenancy (Future)

The current single-tenant version uses environment variables for all configuration. The following changes will be needed for multi-tenancy:

- `factory.ts` will accept a `ClientConfig` object instead of reading from env.
- `outbound-call.ts` will use per-client Twilio subaccount credentials.
- `twiml.ts` will use the `callbackId` to look up the client's WebSocket URL and agent config.
- `media-stream.ts` will resolve the client config from the `callbackId` query param.
- Tool implementations will use per-client Google credentials.
- A new `clients` module will handle config resolution from the database.

These changes are isolated to the function signatures and config resolution layer. The core call flow, audio pipeline, and agent/tool patterns remain identical.

---

## 9. Testing Strategy

**Local Development:**

- Use `ngrok` (or `localtunnel`) to expose the local Fastify server to the internet for Twilio webhooks.
- Set `BASE_URL` to the ngrok HTTPS URL.
- Use `tsx watch src/server.ts` for hot-reload during development.
- Test with a real Twilio phone number calling a personal phone.

**Key Test Scenarios:**

1. **Happy path:** Initiate call → user answers → agent greets → user books appointment → SMS sent → call ends → transcript captured.
2. **No answer:** Initiate call → user doesn't answer → `no-answer` status callback → logged.
3. **Voicemail:** Machine detection fires → handle gracefully (hang up or leave message).
4. **Tool failure:** Google Calendar API returns error → agent tells user there was an issue.
5. **WebSocket drop:** OpenAI connection drops mid-call → graceful error handling → call ends cleanly.
6. **Time limit:** Call reaches 300 seconds → Twilio auto-terminates → transcript captured.
7. **User interrupts agent:** Agent is speaking → user starts talking → audio clears → agent listens.

---

## 10. Deployment Checklist

1. Push code to GitHub repository.
2. Create a new Web Service on Render, connected to the repo.
3. Set environment type to Docker.
4. Add all environment variables from `.env.example`.
5. Set the health check path to `/health`.
6. Ensure the Render plan is **paid Starter tier or above** (required for unlimited WebSocket duration).
7. Configure Twilio:
   - Phone number voice webhook should NOT be set (outbound calls use the REST API `url` parameter).
   - Verify that the Twilio phone number can make outbound calls.
8. Configure Google:
   - Service account with Calendar API and Gmail API enabled.
   - Calendar shared with the service account email.
9. Test the full flow by calling `POST /call/initiate` with a valid phone number.
