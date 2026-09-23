# Private audio transcription

`deepgram.transcription.bytes` transcribes audio through a connected Deepgram API key.
It accepts private bytes in the Hub action request and sends them to Deepgram without a public media URL.
The connector requires no connection metadata.
The action is a billable mutation with an external effect.
The connector declares advisory consistency because this action has no provider compare-and-swap or idempotency key.
That connector-wide declaration also applies to its existing capabilities; direct hosts still use their configured connection consistency model.
An owner must allow `deepgram.transcription.bytes` on the specific Hub connection before an unattended API-key caller can invoke it.
The hosted Platform Hub accepts an owner-session grant through `HubClient.permissions.set` from `@tangle-network/hub-sdk`.
Pass `{ connectionId, actionPath: 'deepgram.transcription.bytes', decision: 'allow' }` to that method.
A direct `IntegrationHub` host instead supplies its own policy engine with an explicit action allow rule.

| Field | Contract |
| --- | --- |
| Input | `{ "contentBase64": string, "contentType": string }` |
| Output | `{ "text": string, "requestId": string \| null, "model": "nova-3", "language": "multi" }` |

`contentBase64` must be canonical base64 and decode to 1 through 16,000,000 bytes.
`contentType` must be a supported audio MIME type, including `audio/ogg; codecs=opus` for WhatsApp voice notes.
The action uses Nova-3 multilingual recognition for English and Spanish in one clip.
It opts this request out of Deepgram's Model Improvement Program, so Deepgram retains content only while processing it.
A valid Deepgram alternative may contain an empty transcript when it recognizes no speech.
The connector rejects a response with no alternative as malformed.

The host should store incoming media privately before invoking this action.
The host should deduplicate and store transcripts at its own private boundary because each provider call is billable.
On hosted Platform `/v1/hub/exec`, a stable `idempotencyKey` can replay a completed result for 24 hours without another provider call.
That platform stores replayable result JSON, including the transcript, for that period subject to its response-size limit.
This connector library does not provide a 24-hour replay ledger for direct `IntegrationHub` hosts.
For less transcript retention, omit the key and persist uncertain outcomes without automatic retries.
Deepgram does not provide a documented idempotency key for this request, so an uncertain provider failure can still have incurred a charge.
The action rejects redirects, unsupported audio types, oversized input, and malformed or oversized provider responses.
Approval, audit, sandbox, and error previews redact the audio bytes and base64 input before storing or displaying them.

Sources: [Deepgram prerecorded audio API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [supported audio formats](https://developers.deepgram.com/docs/supported-audio-formats), [multilingual code switching](https://developers.deepgram.com/docs/multilingual-code-switching), and [data retention](https://developers.deepgram.com/trust-security/your-data).
