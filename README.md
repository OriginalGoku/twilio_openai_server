# Caller Engine

A Node.js/TypeScript service that bridges outbound Twilio phone calls to OpenAI Realtime Agents over bidirectional audio streams.

This service is designed for an orchestrated calling workflow (for example Trigger.dev), where an upstream system calls `POST /call/initiate`, and this service handles:
- outbound call initiation with Twilio
- TwiML generation and media-stream setup
- realtime AI voice interaction
- in-call tool execution (calendar, SMS, optional email)
- transcript collection and optional post-call summary
- Twilio call lifecycle callbacks

## Tech Stack

- Node.js 20+
- TypeScript (strict)
- Fastify + `@fastify/websocket`
- OpenAI Agents SDK (`@openai/agents`, `@openai/agents-extensions`)
- Twilio Node SDK
- Google APIs (Calendar, Gmail)
- Zod validation
- Pino logging

## Project Structure

```text
src/
  agents/
    factory.ts
    prompts.ts
    tools/
      check-availability.ts
      schedule-meeting.ts
      send-email.ts
      send-sms.ts
      index.ts
  config/
    env.ts
  routes/
    call.routes.ts
    health.routes.ts
    twiml.routes.ts
    webhook.routes.ts
  telephony/
    media-stream.ts
    outbound-call.ts
    status-callback.ts
    twiml.ts
  transcription/
    collector.ts
    post-call.ts
  types/
    openai-agents.d.ts
  utils/
    graceful-shutdown.ts
    logger.ts
  server.ts
```

## How It Works

1. Upstream system calls `POST /call/initiate` with `to`, `callbackId`, and `record`.
2. Service uses Twilio REST API to create outbound call.
3. Twilio requests `/twiml/outbound`, receives `<Connect><Stream ...>`.
4. Twilio opens WebSocket media stream at `/media-stream/:callbackId`.
5. Service creates `RealtimeSession` with `TwilioRealtimeTransportLayer`.
6. Service explicitly sends an initial message to force AI greeting when stream/session are ready.
7. Caller and AI talk in realtime. Tools can be invoked automatically by the agent.
8. Twilio posts call lifecycle events to `/webhooks/call-status`.
9. On stream close, transcript is finalized and optional summary is generated.

## API Endpoints

- `GET /health`
  - Returns service health payload.

- `POST /call/initiate`
  - Body:
    ```json
    {
      "callbackId": "e2e-test-001",
      "to": "+15551234567",
      "record": false
    }
    ```
  - Response:
    ```json
    {
      "success": true,
      "callSid": "CA...",
      "status": "queued"
    }
    ```

- `GET|POST /twiml/outbound?callbackId=...`
  - Returns TwiML for Twilio Media Stream.

- `GET /media-stream/:callbackId` (WebSocket)
  - Twilio bidirectional media stream endpoint.

- `POST /webhooks/call-status`
  - Twilio call progress/status callbacks.

## Environment Variables

Create `.env` from `.env.example`.

Required for core flow:
- `BASE_URL` (your public HTTPS URL, typically ngrok in local dev)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

Realtime provider/model selection:
- Configure active provider + model in `src/config/llm.ts`.
- Provider settings are split under `src/config/providers/`.
- Implemented adapters: `openai`, `gemini`.
- Stubbed adapters (config only): `elevenlabs`, `amazon_nova_sonic`.

Optional/tool-specific:
- `OPENAI_API_KEY` (required when provider is `openai`)
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `ENABLE_CALENDAR_TOOLS` (`true|false`)
- `ENABLE_EMAIL_TOOLS` (`true|false`)
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_IMPERSONATED_USER` (required for Gmail send)
- `BUSINESS_TIMEZONE`
- `WORKDAY_START_HOUR`
- `WORKDAY_END_HOUR`
- `SYSTEM_PROMPT`

## Local Development

Install and run:

```bash
npm install
npm run dev
```

Build checks:

```bash
npm run typecheck
npm run build
```

## End-to-End Test With ngrok

1. Start app:
   ```bash
   npm run dev
   ```
2. Start ngrok:
   ```bash
   ngrok http 5050
   ```
3. Set `BASE_URL` to ngrok HTTPS URL and restart app.
4. Verify health:
   ```bash
   curl "$BASE_URL/health"
   ```
5. Trigger call:
   ```bash
   curl -X POST "$BASE_URL/call/initiate" \
     -H "Content-Type: application/json" \
     -d '{"callbackId":"e2e-test-001","to":"+1YOUR_NUMBER","record":false}'
   ```
6. Observe logs for:
   - media stream start (`callSid`, `streamSid`, `callbackId`)
   - realtime session connect
   - initial greeting trigger
   - status callback completion

## Logging and Correlation

The service logs include correlation fields:
- `callbackId` (business-level correlation)
- `callSid` (Twilio call identity)
- `streamSid` (Twilio media stream identity)

Twilio callback payload logging includes:
- `CallStatus`, `SequenceNumber`, `SipResponseCode`, `AnsweredBy`
- error diagnostics (`ErrorCode`, `ErrorMessage`) when present

## Known Notes

- Twilio free/trial accounts inject a trial message and may require keypad confirmation before the call proceeds.
- WebSocket close code `1005` can occur when peer closes without a close frame; this is not automatically an error if call lifecycle is successful.
- Gmail sending with service accounts requires domain-wide delegation and impersonation.

## Deployment

This repo includes a Dockerfile for Render.

High-level deployment steps:
1. Push to GitHub.
2. Create Render Web Service (Docker).
3. Set env vars from `.env.example`.
4. Configure health check path as `/health`.
5. Run live outbound test via `/call/initiate`.

## Security Recommendations

- Add API key auth on `POST /call/initiate` before production.
- Restrict Twilio webhook source validation/signature checks.
- Do not commit `.env` or credentials.

## License

Private/internal project unless you define otherwise.
