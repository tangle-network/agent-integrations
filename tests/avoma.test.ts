import { afterEach, describe, expect, it, vi } from 'vitest'
import { avomaConnector } from '../src/connectors/adapters/avoma.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
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
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('avoma adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the avoma kind', () => {
    expect(avomaConnector.manifest.kind).toBe('avoma')
    expect(avomaConnector.manifest.category).toBe('calendar')
    expect(avomaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = avomaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: calls + meeting reads + write-side update/cancel/notes', () => {
    const names = avomaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.create',
        'calls.update',
        'calls.cancel',
        'notes.create',
        'meetings.transcription.get',
        'meetings.recording.get',
      ].sort(),
    )
    const reads = avomaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = avomaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['meetings.recording.get', 'meetings.transcription.get'])
    expect(mutations).toEqual(['calls.cancel', 'calls.create', 'calls.update', 'notes.create'])
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const writeSide = ['calls.update', 'calls.cancel', 'notes.create']
    for (const name of writeSide) {
      const cap = avomaConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('avoma calls.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/calls/{external_id} with only the patched fields', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ external_id: 'call_42', recording_url: 'https://r/r.mp3' })
      }),
    )
    const result = await avomaConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.update',
      args: {
        external_id: 'call_42',
        patch: { recording_url: 'https://r/r.mp3' },
      },
      idempotencyKey: 'idemp-1',
    })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://api.avoma.com/v1/calls/call_42')
    expect(capturedBody).toEqual({ recording_url: 'https://r/r.mp3' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      avomaConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.update',
        args: { external_id: 'call_42', patch: { recording_url: 'https://r/r.mp3' } },
        idempotencyKey: 'idemp-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('avoma calls.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/calls/{external_id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ ok: true })
      }),
    )
    const result = await avomaConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.cancel',
      args: { external_id: 'call_42' },
      idempotencyKey: 'idemp-cancel',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.avoma.com/v1/calls/call_42')
    expect(result.status).toBe('committed')
  })
})

describe('avoma notes.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the note body to /v1/meetings/{uuid}/notes', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'note_1' })
      }),
    )
    const result = await avomaConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.create',
      args: { meeting_uuid: 'mtg-uuid-7', note: 'follow-up next quarter' },
      idempotencyKey: 'idemp-note',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.avoma.com/v1/meetings/mtg-uuid-7/notes')
    expect(capturedBody).toEqual({ note: 'follow-up next quarter' })
    expect(result.status).toBe('committed')
  })

  it('rejects when meeting_uuid is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      avomaConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.create',
        args: { note: 'orphan' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/meeting_uuid/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      avomaConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.create',
        args: { meeting_uuid: 'mtg', note: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
