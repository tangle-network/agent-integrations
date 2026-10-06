/**
 * ElevenLabs connector — a workspace's own ElevenLabs account (bring your
 * own key). Company-paid voice work goes through the ph0ny connector instead.
 *
 * ElevenLabs authenticates with an `xi-api-key` header, not Bearer.
 *
 *   speech.synthesis      POST /v1/text-to-speech/{voiceId}; audio as base64.
 *   voices.list           GET  /v2/voices; the account's voices.
 *   voices.clone_instant  POST /v1/voices/add (multipart); the requester's
 *                         own voice only, from public sample URLs. Needs a
 *                         paid ElevenLabs plan.
 *   speech_to_text        POST /v1/speech-to-text with cloud_storage_url.
 *   agents.list / agents.create
 *                         Conversational AI agents (/v1/convai/agents).
 */
import { declarativeRestConnector } from './declarative-rest.js'
import { type ConnectorAdapter, type ConnectorInvocation, CredentialsExpired, ProviderRateLimited } from '../types.js'
import { ProviderProtocolError, record, requestJson } from '../../http/response-json.js'
import { IntegrationRuntimeError } from '../../errors.js'

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'
const MAX_SAMPLE_BYTES = 11_000_000

const base = declarativeRestConnector({
  kind: 'elevenlabs',
  displayName: 'ElevenLabs',
  description:
    'Your own ElevenLabs account: text to speech, voices, instant voice clones of your own voice, speech to text, and conversational voice agents.',
  auth: { kind: 'api-key', hint: 'ElevenLabs API key (Profile > API keys).' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: ELEVENLABS_BASE_URL,
  credentialPlacement: { kind: 'header', header: 'xi-api-key' },
  test: { method: 'GET', path: '/v1/user' },
  capabilities: [
    {
      name: 'speech.synthesis',
      class: 'mutation',
      description: 'Convert text to speech. Returns the MP3 audio as base64 with its content type.',
      parameters: {
        type: 'object',
        properties: {
          voiceId: { type: 'string', description: 'voice_id from voices.list' },
          text: { type: 'string', description: 'The text to convert to speech' },
          modelId: { type: 'string', description: 'Optional model id, e.g. eleven_multilingual_v2' },
        },
        required: ['voiceId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/v1/text-to-speech/{voiceId}',
        query: { output_format: 'mp3_44100_128' },
        body: { text: '{text}', model_id: '{modelId}' },
        responseBody: 'base64',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'voices.list',
      class: 'read',
      description: 'List the voices on the ElevenLabs account, optionally filtered by name.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filter by name or description' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          nextPageToken: { type: 'string', description: 'Pagination token from a prior response' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/voices',
        query: { search: '{search}', page_size: '{pageSize}', next_page_token: '{nextPageToken}' },
      },
    },
    {
      name: 'agents.list',
      class: 'read',
      description: 'List the conversational voice agents on the ElevenLabs account.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/convai/agents',
        query: { search: '{search}', page_size: '{pageSize}', cursor: '{cursor}' },
      },
    },
  ],
})

export const elevenlabsConnector: ConnectorAdapter = {
  ...base,
  manifest: {
    ...base.manifest,
    capabilities: [
      ...base.manifest.capabilities,
      {
        name: 'voices.clone_instant',
        class: 'mutation',
        cas: 'none',
        externalEffect: true,
        // Creates a new provider resource each time; nothing to compare-and-swap.
        consistencyModel: 'advisory',
        description:
          'Instant-clone the requester\'s OWN voice from 1-5 public recordings (needs a paid ElevenLabs plan). consent.subject must be "self" and consent.statement must quote the speaker consenting; never clone anyone else.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            sampleUrls: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
            description: { type: 'string', maxLength: 500 },
            removeBackgroundNoise: { type: 'boolean' },
            consent: {
              type: 'object',
              properties: {
                subject: { type: 'string', enum: ['self'] },
                statement: { type: 'string' },
              },
              required: ['subject', 'statement'],
            },
          },
          required: ['name', 'sampleUrls', 'consent'],
          additionalProperties: false,
        },
      },
      {
        name: 'speech_to_text',
        class: 'read',
        consistencyModel: 'authoritative',
        description: 'Transcribe a public audio or video URL with ElevenLabs Scribe (billed per audio minute).',
        parameters: {
          type: 'object',
          properties: {
            audioUrl: { type: 'string', description: 'Public https URL of the recording' },
            languageCode: { type: 'string', description: 'ISO 639 code; omitted auto-detects' },
            diarize: { type: 'boolean' },
          },
          required: ['audioUrl'],
          additionalProperties: false,
        },
      },
      {
        name: 'agents.create',
        class: 'mutation',
        cas: 'none',
        externalEffect: true,
        // Creates a new provider resource each time; nothing to compare-and-swap.
        consistencyModel: 'advisory',
        description: 'Create an ElevenLabs conversational voice agent with a prompt, greeting and voice.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            prompt: { type: 'string', minLength: 1, maxLength: 20000, description: 'System prompt' },
            firstMessage: { type: 'string', maxLength: 1000, description: 'What the agent says first' },
            voiceId: { type: 'string', description: 'voice_id from voices.list' },
            language: { type: 'string', description: 'ISO 639-1 code; defaults to en' },
          },
          required: ['name', 'prompt'],
          additionalProperties: false,
        },
      },
    ],
  },
  async executeRead(inv) {
    if (inv.capabilityName !== 'speech_to_text') return base.executeRead!(inv)
    const audioUrl = httpsUrl(inv.args.audioUrl, 'audioUrl')
    const form = new FormData()
    form.append('model_id', 'scribe_v1')
    form.append('cloud_storage_url', audioUrl)
    if (typeof inv.args.languageCode === 'string' && /^[a-z]{2,3}$/.test(inv.args.languageCode)) {
      form.append('language_code', inv.args.languageCode)
    }
    if (inv.args.diarize === true) form.append('diarize', 'true')
    const json = await elevenlabs(inv, '/v1/speech-to-text', form, 300_000)
    return {
      data: {
        text: typeof json.text === 'string' ? json.text : '',
        languageCode: json.language_code ?? null,
        ...(Array.isArray(json.words) && inv.args.diarize === true ? { words: json.words } : {}),
      },
      fetchedAt: Date.now(),
    }
  },
  async executeMutation(inv) {
    if (inv.capabilityName === 'voices.clone_instant') {
      const { name, sampleUrls, description, removeBackgroundNoise, consent } = inv.args
      if (typeof name !== 'string' || !name.trim() || name.length > 100) invalid('name must be 1-100 chars')
      if (!record(consent) || consent.subject !== 'self' || typeof consent.statement !== 'string' ||
          consent.statement.trim().length < 10 || !/consent/i.test(consent.statement)) {
        invalid('Only the requester\'s own voice can be cloned: consent.subject must be "self" and consent.statement must quote them consenting')
      }
      if (!Array.isArray(sampleUrls) || sampleUrls.length < 1 || sampleUrls.length > 5) invalid('sampleUrls must hold 1-5 URLs')
      const form = new FormData()
      form.append('name', name)
      if (typeof description === 'string' && description) form.append('description', description.slice(0, 500))
      if (removeBackgroundNoise === true) form.append('remove_background_noise', 'true')
      form.append('labels', JSON.stringify({ consent: 'self', consent_statement: consent.statement.slice(0, 200) }))
      for (const [i, url] of sampleUrls.entries()) {
        const sample = await downloadSample(httpsUrl(url, 'sampleUrls[]'))
        form.append('files', new Blob([Uint8Array.from(sample.bytes)], { type: sample.contentType }), `sample-${i}`)
      }
      const json = await elevenlabs(inv, '/v1/voices/add', form, 120_000)
      return {
        status: 'committed',
        data: { voiceId: json.voice_id ?? null, requiresVerification: json.requires_verification ?? false },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    if (inv.capabilityName === 'agents.create') {
      const { name, prompt, firstMessage, voiceId, language } = inv.args
      if (typeof name !== 'string' || !name.trim()) invalid('name is required')
      if (typeof prompt !== 'string' || !prompt.trim()) invalid('prompt is required')
      const body = {
        name,
        conversation_config: {
          agent: {
            prompt: { prompt },
            ...(typeof firstMessage === 'string' ? { first_message: firstMessage } : {}),
            language: typeof language === 'string' ? language : 'en',
          },
          ...(typeof voiceId === 'string' ? { tts: { voice_id: voiceId } } : {}),
        },
      }
      const json = await elevenlabs(inv, '/v1/convai/agents/create', JSON.stringify(body), 30_000)
      return { status: 'committed', data: { agentId: json.agent_id ?? null }, committedAt: Date.now(), idempotentReplay: false }
    }
    return base.executeMutation!(inv)
  },
}

function invalid(message: string): never {
  throw new IntegrationRuntimeError({ code: 'input_invalid', message: `ElevenLabs ${message}` })
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value) || new URL(value).protocol !== 'https:') {
    invalid(`${field} must be an https URL`)
  }
  return value
}

async function downloadSample(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  if (!res.ok) invalid(`could not download sample (${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_SAMPLE_BYTES) invalid('each sample must be under 11 MB')
  return { bytes, contentType: res.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream' }
}

async function elevenlabs(
  inv: ConnectorInvocation,
  path: string,
  body: FormData | string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const creds = inv.source.credentials
  if (creds.kind !== 'api-key' || !creds.apiKey || /[\u0000- \u007f]/.test(creds.apiKey)) {
    throw new IntegrationRuntimeError({
      code: 'provider_auth_failed',
      message: 'ElevenLabs requires the connected API key',
      userAction: { type: 'reconnect', label: 'Reconnect ElevenLabs' },
    })
  }
  try {
    const json = await requestJson(`${ELEVENLABS_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'xi-api-key': creds.apiKey, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
      body,
    }, { timeoutMs, maxResponseBytes: 8_000_000 })
    if (!record(json)) throw new ProviderProtocolError('ElevenLabs returned a non-object response', 'invalid_response')
    return json
  } catch (error) {
    if (error instanceof ProviderProtocolError && error.status === 401) {
      throw new CredentialsExpired('ElevenLabs rejected the connected API key', inv.source.id, { status: 401 })
    }
    if (error instanceof ProviderProtocolError && error.status === 429) {
      throw new ProviderRateLimited('ElevenLabs rate limit', inv.source.id, { status: 429, retryAfterMs: error.retryAfterMs ?? 60_000 })
    }
    if (error instanceof ProviderProtocolError && [400, 402, 403, 413, 415, 422].includes(error.status)) {
      throw new IntegrationRuntimeError({
        code: 'input_invalid',
        message: `ElevenLabs refused the request (${error.status}${error.status === 402 || error.status === 403 ? ': this feature may need a paid plan' : ''})`,
      })
    }
    throw error
  }
}
