import { declarativeRestConnector } from './declarative-rest.js'

// GreenPT is a privacy-friendly AI platform. The REST surface is OpenAI-shaped:
// /chat/completions, /embeddings, plus a Deepgram-style /listen transcription
// endpoint. Bearer auth carries the API key on every call.
export const greenptConnector = declarativeRestConnector({
  kind: 'greenpt',
  displayName: 'GreenPT',
  description: 'Privacy-friendly GPT chat, embeddings, and audio transcription via the GreenPT API.',
  auth: {
    kind: 'api-key',
    hint: 'GreenPT API key, sent as `Authorization: Bearer <key>`.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.greenpt.ai/v1',
  test: { method: 'POST', path: '/chat/completions' },
  capabilities: [
    {
      name: 'chat.completion',
      class: 'mutation',
      description: 'Run a chat completion against a GreenPT model (green-l, green-l-raw, green-r, …).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'GreenPT model id, e.g. green-l, green-l-raw, green-r.' },
          messages: {
            type: 'array',
            description: 'OpenAI-shaped chat messages.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          stream: { type: 'boolean', description: 'Server-sent streaming. Defaults to false.' },
        },
        required: ['model', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/chat/completions',
        body: {
          model: '{model}',
          messages: '{messages}',
          stream: '{stream}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'create.embeddings',
      class: 'mutation',
      description: 'Generate embeddings for one or more text inputs using the green-embedding model.',
      parameters: {
        type: 'object',
        properties: {
          input: {
            description: 'Text to embed. Either a single string or an array of strings.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          model: {
            type: 'string',
            description: 'Embedding model id. Defaults to green-embedding when omitted.',
          },
          encoding_format: {
            type: 'string',
            enum: ['float', 'base64'],
            description: 'Return floats or base64-encoded vectors.',
          },
        },
        required: ['input'],
      },
      request: {
        method: 'POST',
        path: '/embeddings',
        body: {
          model: '{model}',
          input: '{input}',
          encoding_format: '{encoding_format}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transcribe.audio',
      class: 'mutation',
      description:
        'Transcribe an audio recording. Accepts a publicly reachable audio URL plus Deepgram-style flags (diarize, punctuate, smart_format, filler_words, numerals, sentiment, topics, intents).',
      parameters: {
        type: 'object',
        properties: {
          audioUrl: { type: 'string', description: 'URL of the audio file to transcribe (WAV, MP3, FLAC, …).' },
          model: { type: 'string', description: 'Speech-to-text model id.' },
          language: { type: 'string', description: 'BCP-47 language code (en, fr, de, …). Auto-detected when omitted.' },
          diarize: { type: 'boolean', description: 'Identify distinct speakers.' },
          punctuate: { type: 'boolean', description: 'Add punctuation and capitalisation.' },
          smart_format: { type: 'boolean', description: 'Apply formatting for readability.' },
          filler_words: { type: 'boolean', description: 'Preserve filler words.' },
          numerals: { type: 'boolean', description: 'Convert spelled-out numbers to numerals.' },
          sentiment: { type: 'boolean', description: 'Run sentiment analysis on the transcript.' },
          topics: { type: 'boolean', description: 'Detect topics throughout the transcript.' },
          intents: { type: 'boolean', description: 'Recognise speaker intents throughout the transcript.' },
        },
        required: ['audioUrl'],
      },
      request: {
        method: 'POST',
        path: '/listen',
        query: {
          model: '{model}',
          language: '{language}',
          diarize: '{diarize}',
          punctuate: '{punctuate}',
          smart_format: '{smart_format}',
          filler_words: '{filler_words}',
          numerals: '{numerals}',
          sentiment: '{sentiment}',
          topics: '{topics}',
          intents: '{intents}',
        },
        body: { url: '{audioUrl}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
