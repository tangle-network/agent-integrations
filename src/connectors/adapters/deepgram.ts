import { declarativeRestConnector } from './declarative-rest.js'

export const deepgramConnector = declarativeRestConnector({
  kind: 'deepgram',
  displayName: 'Deepgram',
  description: 'Transcribe audio to text, synthesize text to speech, and analyze audio content with AI-powered speech recognition.',
  auth: { kind: 'api-key', hint: 'Deepgram API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.deepgram.com/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'transcription.create',
      class: 'mutation',
      description: 'Transcribe audio from a URL or file upload to text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the audio file to transcribe.' },
          model: { type: 'string', description: 'Model to use (nova-2, nova-2-general, nova-2-meeting, etc.).' },
          language: { type: 'string', description: 'BCP-47 language code (e.g., en, es, fr).' },
          punctuate: { type: 'boolean', description: 'Enable punctuation in transcript.' },
          paragraphs: { type: 'boolean', description: 'Enable paragraph breaks.' },
          diarize: { type: 'boolean', description: 'Enable speaker diarization.' },
          smart_format: { type: 'boolean', description: 'Enable smart formatting.' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/listen',
        query: {
          model: '{model}',
          language: '{language}',
          punctuate: '{punctuate}',
          paragraphs: '{paragraphs}',
          diarize: '{diarize}',
          smart_format: '{smart_format}',
        },
        body: { url: '{url}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transcription.get',
      class: 'read',
      description: 'Get the status and result of a transcription request.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string', description: 'ID of the transcription request.' } },
        required: ['requestId'],
      },
      request: { method: 'GET', path: '/listen/{requestId}' },
    },
    {
      name: 'speak.generate',
      class: 'mutation',
      description: 'Convert text to speech with AI-powered voice synthesis.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to synthesize into speech.' },
          model: { type: 'string', description: 'Voice model to use (aura-asteria-en, aura-luna-en, etc.).' },
          encoding: { type: 'string', description: 'Output audio encoding (linear16, pcm, ulaw, etc.).' },
          sample_rate: { type: 'integer', description: 'Sample rate in Hz (e.g., 16000, 24000).' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/speak',
        query: {
          model: '{model}',
          encoding: '{encoding}',
          sample_rate: '{sample_rate}',
        },
        body: { text: '{text}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List all projects in your Deepgram account.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/projects' },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Get details of a specific project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'UUID of the project.' } },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/projects/{projectId}' },
    },
    {
      name: 'usage.list',
      class: 'read',
      description: 'Get usage analytics and billing information for a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'UUID of the project.' },
          startDateTime: { type: 'string', description: 'Start date in ISO 8601 format.' },
          endDateTime: { type: 'string', description: 'End date in ISO 8601 format.' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/usage',
        query: { start_datetime: '{startDateTime}', end_datetime: '{endDateTime}' },
      },
    },
    {
      name: 'keys.list',
      class: 'read',
      description: 'List all API keys for a project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'UUID of the project.' } },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/projects/{projectId}/keys' },
    },
    {
      name: 'keys.create',
      class: 'mutation',
      description: 'Create a new API key for a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'UUID of the project.' },
          comment: { type: 'string', description: 'Comment or description for the key.' },
          scopes: { type: 'array', description: 'List of scopes (e.g., ["admin", "member"]).' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/keys',
        body: { comment: '{comment}', scopes: '{scopes}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
