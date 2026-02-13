1. Backend receives "initiate call" request (from Trigger.dev workflow)
       ↓
2. Backend calls Twilio REST API: create outbound call
   - to: user's verified phone number
   - url: https://your-render-app.com/twiml/outbound
   - statusCallback: https://your-render-app.com/call/status-callback
   - timeLimit: 300 (5 min)
   - record: true (if consented)
       ↓
3. User answers phone → Twilio fetches TwiML from /twiml/outbound
   - TwiML returns ONLY: <Connect><Stream url="wss://..." /></Connect>
   - NO <Say> — the AI generates ALL audio including the greeting
       ↓
4. Twilio opens WebSocket to /media-stream on your server
       ↓
5. Server creates TwilioRealtimeTransportLayer + RealtimeSession
   - Audio format: g711_ulaw passthrough (automatic, no transcoding)
   - Agent loaded from client config (instructions, tools, voice)
   - Agent instructions include greeting behavior:
     "Greet the caller briefly and ask what they want help with."
   - Session connects to OpenAI Realtime API
   - Agent auto-responds with greeting (first audio the user hears)
       ↓
6. Bidirectional audio flows:
   Twilio (user) ←→ TwilioRealtimeTransportLayer ←→ OpenAI Realtime
   - Interruptions handled automatically by transport layer
   - No manual clear/cancel logic needed
       ↓
7. Agent invokes tools (schedule meeting, etc.)
   - Defined via SDK tool() with zod schemas
   - SDK handles function_call → execute → function_call_output → response.create
   - No manual response.create after tool output needed
       ↓
8. Call ends (user hangs up, time limit, or agent completes)
       ↓
9. Transcript collected from session events → stored → summary generated