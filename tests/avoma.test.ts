import { afterEach, describe, expect, it, vi } from 'vitest'
import { avomaConnector } from '../src/connectors/adapters/avoma.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_avoma_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'avoma',
    label: 'Avoma test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'avoma_secret' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('avoma adapter manifest', () => {
  it('exposes exactly the three published Avoma actions', () => {
    expect(avomaConnector.manifest).toMatchObject({
      kind: 'avoma',
      category: 'calendar',
      defaultConsistencyModel: 'authoritative',
      auth: { kind: 'api-key' },
    })
    expect(avomaConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual(
      ['calls.create', 'meetings.recording.get', 'meetings.transcription.get'],
    )
    const create = avomaConnector.manifest.capabilities.find((capability) => capability.name === 'calls.create')
    expect(create).toMatchObject({ class: 'mutation', cas: 'native-idempotency', externalEffect: true })
  })
})

describe('avoma execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts a completed call to the documented /v1/calls/ route with bearer auth', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestHeaders: Record<string, string> = {}
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestHeaders = init?.headers as Record<string, string>
      requestBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ external_id: 'call_42' }, 201)
    }))

    await avomaConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.create',
      args: {
        external_id: 'call_42',
        user_email: 'rep@example.com',
        source: 'twilio',
        direction: 'outbound',
        start_at: '2026-07-30T12:00:00Z',
        frm: '+12025550123',
        to: '+12025550124',
        recording_url: 'https://media.example.com/call.mp3',
      },
      idempotencyKey: 'avoma-create-42',
    })

    expect(requestUrl).toBe('https://api.avoma.com/v1/calls/')
    expect(requestMethod).toBe('POST')
    expect(requestHeaders.authorization).toBe('Bearer avoma_secret')
    expect(requestBody).toMatchObject({ external_id: 'call_42', source: 'twilio' })
    expect(requestBody).not.toHaveProperty('participants')
  })

  it('gets a transcription by transcription UUID', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ uuid: 'tr_7', transcript: [] })
    }))

    await avomaConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.transcription.get',
      args: { transcription_uuid: 'tr_7' },
      idempotencyKey: 'avoma-read-transcription-7',
    })

    expect(requestUrl).toBe('https://api.avoma.com/v1/transcriptions/tr_7')
  })

  it('gets recording URLs through the meeting_uuid query route', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ meeting_uuid: 'mtg_9', audio_url: 'https://media.example.com/audio' })
    }))

    await avomaConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.recording.get',
      args: { meeting_uuid: 'mtg_9' },
      idempotencyKey: 'avoma-read-recording-9',
    })

    expect(requestUrl).toBe('https://api.avoma.com/v1/recordings/?meeting_uuid=mtg_9')
  })

  it('surfaces rejected Avoma credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(avomaConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.recording.get',
      args: { meeting_uuid: 'mtg_9' },
      idempotencyKey: 'avoma-rejected-recording-9',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
