import { declarativeRestConnector } from './declarative-rest.js'
import { type ConnectorAdapter, CredentialsExpired, ProviderRateLimited } from '../types.js'
import { ProviderProtocolError, record, requestJson } from '../../http/response-json.js'

const MAX_AUDIO_BYTES = 16_000_000
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_AUDIO_BYTES / 3)
const AUDIO_TYPES = new Set([
  'audio/aac', 'audio/flac', 'audio/m4a', 'audio/mp4', 'audio/mpeg',
  'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
])

function privateAudio(args: Record<string, unknown>): { bytes: Buffer; contentType: string } {
  const rawType = args.contentType
  if (typeof rawType !== 'string' || rawType.length > 200 || /[\u0000-\u001f\u007f]/.test(rawType)) {
    throw new Error('Deepgram requires a supported audio contentType')
  }
  const contentType = rawType.split(';', 1)[0]!.trim().toLowerCase()
  if (!AUDIO_TYPES.has(contentType)) throw new Error('Deepgram requires a supported audio contentType')
  const raw = args.contentBase64
  if (typeof raw !== 'string' || raw.length < 4 || raw.length > MAX_BASE64_LENGTH ||
      raw.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    throw new Error('Deepgram requires canonical contentBase64 within the 16 MB limit')
  }
  const bytes = Buffer.from(raw, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES || bytes.toString('base64') !== raw) {
    throw new Error('Deepgram requires canonical contentBase64 within the 16 MB limit')
  }
  return { bytes, contentType }
}

function transcriptResponse(value: unknown): { text: string; requestId: string | null; model: 'nova-3'; language: 'multi' } {
  if (!record(value) || !record(value.results) || !Array.isArray(value.results.channels)) {
    throw new ProviderProtocolError('Deepgram returned no transcription channels', 'invalid_response')
  }
  const channel = value.results.channels[0]
  if (!record(channel) || !Array.isArray(channel.alternatives) || !record(channel.alternatives[0])) {
    throw new ProviderProtocolError('Deepgram returned no transcription alternative', 'invalid_response')
  }
  const text = channel.alternatives[0].transcript
  if (typeof text !== 'string' || text.length > 64_000) {
    throw new ProviderProtocolError('Deepgram returned an invalid transcript', 'invalid_response')
  }
  const requestId = record(value.metadata) ? value.metadata.request_id : undefined
  if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 256)) {
    throw new ProviderProtocolError('Deepgram returned an invalid request id', 'invalid_response')
  }
  return { text, requestId: requestId ?? null, model: 'nova-3', language: 'multi' }
}

const base = declarativeRestConnector({
  kind: 'deepgram',
  displayName: 'Deepgram',
  description: 'Transcribe audio to text, synthesize text to speech, and analyze audio content with AI-powered speech recognition.',
  auth: { kind: 'api-key', hint: 'Deepgram API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.deepgram.com/v1',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Token ' },
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

export const deepgramConnector: ConnectorAdapter = {
  ...base,
  manifest: { ...base.manifest, capabilities: [...base.manifest.capabilities,
    { name: 'transcription.bytes', class: 'read',
      description: 'Transcribe private audio bytes with Nova-3 multilingual. Supports English and Spanish in the same clip; up to 16 MB. This billable read sends audio to Deepgram, without exposing a public media URL.',
      parameters: { type: 'object', properties: {
        contentBase64: { type: 'string', minLength: 4, maxLength: MAX_BASE64_LENGTH },
        contentType: { type: 'string', minLength: 1, maxLength: 200 },
      }, required: ['contentBase64', 'contentType'], additionalProperties: false } },
  ] },
  async executeRead(inv) {
    if (inv.capabilityName !== 'transcription.bytes') return base.executeRead!(inv)
    const { bytes, contentType } = privateAudio(inv.args)
    if (inv.source.credentials.kind !== 'api-key' || !inv.source.credentials.apiKey ||
        /[\u0000-\u0020\u007f]/.test(inv.source.credentials.apiKey)) {
      throw new Error('Deepgram requires the connected API key')
    }
    let response: unknown
    try {
      response = await requestJson('https://api.deepgram.com/v1/listen?model=nova-3&language=multi&punctuate=true', {
        method: 'POST',
        headers: { Authorization: `Token ${inv.source.credentials.apiKey}`, 'Content-Type': contentType },
        body: Uint8Array.from(bytes),
      }, { timeoutMs: 60_000, maxResponseBytes: 250_000 })
    } catch (error) {
      if (error instanceof ProviderProtocolError && error.status === 401) {
        throw new CredentialsExpired('Deepgram rejected the connected API key', inv.source.id, { status: 401 })
      }
      if (error instanceof ProviderProtocolError && error.status === 429) {
        throw new ProviderRateLimited('Deepgram rate limit', inv.source.id, { status: 429 })
      }
      throw error
    }
    return { data: transcriptResponse(response), fetchedAt: Date.now() }
  },
}
