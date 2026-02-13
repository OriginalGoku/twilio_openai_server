caller-engine/
├── src/
│   ├── server.ts                  # Fastify HTTP + WebSocket server
│   ├── config/
│   │   └── env.ts                 # Env validation (zod)
│   │
│   ├── agents/
│   │   ├── factory.ts             # Build RealtimeAgent from client config
│   │   ├── prompts.ts             # System prompt templates per client type
│   │   └── tools/
│   │       ├── schedule-meeting.ts
│   │       ├── check-availability.ts
│   │       ├── send-sms.ts
│   │       └── index.ts           # Tool registry (replaces your TOOL_DISPATCH)
│   │
│   ├── telephony/
│   │   ├── outbound-call.ts       # Twilio REST: create call
│   │   ├── media-stream.ts        # WS handler: TwilioRealtimeTransportLayer
│   │   ├── twiml.ts               # Returns <Connect><Stream> only
│   │   └── status-callback.ts     # Call lifecycle events
│   │
│   ├── transcription/
│   │   ├── collector.ts           # Listen to session transcript events
│   │   └── post-call.ts           # Save + LLM summary
│   │
│   ├── routes/
│   │   ├── call.routes.ts         # POST /call/initiate
│   │   ├── twiml.routes.ts        # POST /twiml/outbound
│   │   ├── webhook.routes.ts      # POST /call/status-callback
│   │   └── health.routes.ts       # GET /health
│   │
│   └── utils/
│       ├── logger.ts              # pino
│       └── graceful-shutdown.ts   # SIGTERM drain
│
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
