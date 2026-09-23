# Private audio transcription

`deepgram.transcription.bytes` transcribes audio through a connected Deepgram API key.
It accepts private bytes in the Hub action request and sends them to Deepgram without a public media URL.
The connector requires no connection metadata.
The action is a billable mutation with an external effect.
This action declares advisory consistency because it has no provider compare-and-swap or idempotency key.
The connector's existing actions keep their authoritative default.
An owner must allow `deepgram.transcription.bytes` on the specific Hub connection before an unattended API-key caller can invoke it.
The hosted Platform Hub accepts an owner-session grant through `HubClient.permissions.set` from `@tangle-network/hub-sdk`.
Pass `{ connectionId, actionPath: 'deepgram.transcription.bytes', decision: 'allow' }` to that method.
A direct `IntegrationHub` host instead supplies its own policy engine with an explicit action allow rule.

| Field | Contract |
| --- | --- |
| Input | `{ "contentBase64": string, "contentType": string }` |
| Output | `{ "text": string, "requestId": string \| null, "model": "nova-3", "language": "multi" }` |

`contentBase64` must be canonical base64 and decode to 1 through 16,000,000 bytes.
Sandbox envelopes default to a 256 KiB input limit.
A sandbox host that carries larger audio must pass the same `maxInputBytes` to `buildIntegrationInvocationEnvelope` and `IntegrationSandboxHost`.
For the maximum clip, use `4 * Math.ceil(16_000_000 / 3) + 4096` bytes to cover base64 and JSON overhead.
Hosted Hub `tools.invoke` calls use the Platform exec path and do not use this sandbox envelope.
`contentType` must be a supported audio MIME type, including `audio/ogg; codecs=opus` for WhatsApp voice notes.
The action uses Nova-3 multilingual recognition for English and Spanish in one clip.
It opts this request out of Deepgram's Model Improvement Program, so Deepgram retains content only while processing it.
A valid Deepgram alternative may contain an empty transcript when it recognizes no speech.
The connector rejects a response with no alternative as malformed.
It returns a valid transcript even if the optional provider request ID is malformed; `requestId` is then `null`.

The host should store incoming media privately before invoking this action.
The host should deduplicate and store transcripts at its own private boundary because each provider call is billable.
On hosted Platform `/v1/hub/exec`, a stable `idempotencyKey` can replay a completed result for 24 hours without another provider call.
That platform stores replayable result JSON, including the transcript, for that period subject to its response-size limit.
This connector library does not provide a 24-hour replay ledger for direct `IntegrationHub` hosts.
For less transcript retention, omit the key and persist uncertain outcomes without automatic retries.
Deepgram does not provide a documented idempotency key for this request, so an uncertain provider failure can still have incurred a charge.
The action rejects redirects, unsupported audio types, oversized input, and malformed or oversized provider responses.
It caps the provider JSON response at 8,000,000 bytes; a limit error after upload has an uncertain billed outcome.
Approval, audit, sandbox, and error previews redact the audio bytes and base64 input before storing or displaying them.

Sources: [Deepgram prerecorded audio API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [supported audio formats](https://developers.deepgram.com/docs/supported-audio-formats), [multilingual code switching](https://developers.deepgram.com/docs/multilingual-code-switching), and [data retention](https://developers.deepgram.com/trust-security/your-data).
