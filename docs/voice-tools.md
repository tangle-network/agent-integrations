# Voice tools

Agents get voice through two connectors.

| Need | Connector | Who pays |
|---|---|---|
| Voice memo, voices, self-clone, transcription, voice agents, phone calls | `phony` (ph0ny) | The connected ph0ny account. Tangle's Hub connects with a Tangle-owned key; ph0ny holds the provider keys. |
| The same on a workspace's own ElevenLabs account | `elevenlabs` | The workspace (bring your own key). |

## ph0ny

| Capability | What it does |
|---|---|
| `list_voices` | Clones and provider voices. Each names `provider` and `providerVoiceId`; set them as an agent's `ttsProvider` and `voiceId`. `provider: "cartesia"` adds Cartesia's stock voices, the default call voices. |
| `synthesize_speech` | A voice memo. ph0ny stores the audio and returns `audioUrl`, valid for about an hour. Save the file; do not pass audio through the conversation. |
| `transcribe` | Speech to text from a public URL. |
| `clone_voice` | Instant clone of the requester's own voice. `consent.subject` must be `"self"` and `consent.statement` must quote them consenting. ph0ny stores the consent with the voice. Cloning another person is refused until signed third-party consent can be bound to the request. |
| `create_agent`, `update_agent`, `list_agents` | Voice agents. `personal_assistant` agents place calls. |
| `list_phone_numbers` | Caller ids for `start_outbound_call`. |
| `start_outbound_call` | A mission call: the agent opens by saying it is an AI assistant calling on the user's behalf, pursues `mission.goal`, and extracts the answer. `voiceCloneId` speaks with a clone (the agent's `ttsProvider` must match the clone's provider). `callback` receives the outcome once when the call ends. |
| `get_call`, `list_calls` | Call status, transcript, extracted fields and recording. |

### Call outcome callback

ph0ny POSTs one JSON body to `callback.url` when the call ends, whether it was answered, failed, busy or unanswered:

```json
{ "event": "outbound.call.completed", "callId": "...", "status": "completed", "goalMet": true,
  "summary": "...", "extractedFields": { "summary": "...", "outcome": "..." },
  "transcript": [{ "role": "assistant", "content": "..." }], "recordingUrl": "https://...", "durationMs": 61000 }
```

It is signed `X-Signature: hex(HMAC-SHA256(body, callback.token))` and carries `Authorization: Bearer <callback.token>` and `Idempotency-Key: outbound-outcome-<callId>`. The recording URL is signed for 7 days.

### Outbound gate

ph0ny dials only when its operator enabled outbound, the destination is on ph0ny's `OUTBOUND_ALLOWED_TO_NUMBERS` (people who agreed to test calls), or the caller's own call hook admits the number. Every call needs `userConsentRecorded: true` from the user who asked for it.

## ElevenLabs

`speech.synthesis` (base64 MP3), `voices.list`, `voices.clone_instant` (own voice only, paid ElevenLabs plan), `speech_to_text` (Scribe, from a URL), `agents.list`, `agents.create`. The key is sent as `xi-api-key`.
