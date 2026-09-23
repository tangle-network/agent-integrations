# Private audio transcription

`deepgram.transcription.bytes` transcribes audio through a connected Deepgram API key.
It accepts private bytes in the Hub action request and sends them to Deepgram without a public media URL.
The connector requires no connection metadata.
The action is a billable mutation with an external effect.
An owner must allow `deepgram.transcription.bytes` on the specific Hub connection before an unattended API-key caller can invoke it.
An owner-session client can set `{ connectionId, actionPath: 'deepgram.transcription.bytes', decision: 'allow' }` through `HubClient.permissions.set`.

| Field | Contract |
| --- | --- |
| Input | `{ "contentBase64": string, "contentType": string }` |
| Output | `{ "text": string, "requestId": string \| null, "model": "nova-3", "language": "multi" }` |

`contentBase64` must be canonical base64 and decode to 1 through 16,000,000 bytes.
`contentType` must be a supported audio MIME type, including `audio/ogg; codecs=opus` for WhatsApp voice notes.
The action uses Nova-3 multilingual recognition for English and Spanish in one clip.
It opts this request out of Deepgram's Model Improvement Program, so Deepgram retains content only while processing it.
It returns an empty transcript when Deepgram recognizes no speech.

The host should store incoming media privately before invoking this action.
The host should deduplicate and store transcripts at its own private boundary because each provider call is billable.
If the host passes a stable Hub `idempotencyKey`, a successful direct execution can replay for 24 hours without another Deepgram call.
The Hub ledger stores the successful transcript JSON for that period.
For stricter privacy, omit the key and persist uncertain outcomes without automatic retries.
Deepgram does not provide a documented idempotency key for this request, so an uncertain provider failure can still have incurred a charge.
The action rejects redirects, unsupported audio types, oversized input, and malformed or oversized provider responses.

Sources: [Deepgram prerecorded audio API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [supported audio formats](https://developers.deepgram.com/docs/supported-audio-formats), [multilingual code switching](https://developers.deepgram.com/docs/multilingual-code-switching), and [data retention](https://developers.deepgram.com/trust-security/your-data).
