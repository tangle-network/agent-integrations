# Private audio transcription

`deepgram.transcription.bytes` transcribes audio through a connected Deepgram API key.
It accepts private bytes in the Hub action request and sends them to Deepgram without a public media URL.
The connector requires no connection metadata.

| Field | Contract |
| --- | --- |
| Input | `{ "contentBase64": string, "contentType": string }` |
| Output | `{ "text": string, "requestId": string \| null, "model": "nova-3", "language": "multi" }` |

`contentBase64` must be canonical base64 and decode to 1 through 16,000,000 bytes.
`contentType` must be a supported audio MIME type, including `audio/ogg; codecs=opus` for WhatsApp voice notes.
The action uses Nova-3 multilingual recognition for English and Spanish in one clip.
It returns an empty transcript when Deepgram recognizes no speech.

The host should store incoming media privately before invoking this action.
The host should deduplicate and store transcripts at its own private boundary because each provider call is billable.
For privacy-sensitive audio, omit the Hub `idempotencyKey` on this read action: the Hub idempotency ledger stores successful response JSON for replay.
The action rejects redirects, unsupported audio types, oversized input, and malformed or oversized provider responses.

Sources: [Deepgram prerecorded audio API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [supported audio formats](https://developers.deepgram.com/docs/supported-audio-formats), and [multilingual code switching](https://developers.deepgram.com/docs/multilingual-code-switching).
