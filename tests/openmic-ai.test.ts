import { afterEach, describe, expect, it, vi } from 'vitest'
import { openmicAiConnector } from '../src/connectors/adapters/openmic-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_openmic_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'openmic-ai',
    label: 'OpenMic test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'openmic_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('openmic-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the openmic-ai kind', () => {
    expect(openmicAiConnector.manifest.kind).toBe('openmic-ai')
    expect(openmicAiConnector.manifest.category).toBe('comms')
    expect(openmicAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = openmicAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/OpenMic/i)
  })

  it('covers phone calls, bots, and calls capability surface', () => {
    const names = openmicAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.create',
        'bots.list',
        'bots.find',
        'calls.list',
        'calls.find',
        'bots.create',
        'bots.update',
        'bots.delete',
        'calls.cancel',
      ].sort(),
    )
    const mutations = openmicAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'calls.create',
        'bots.create',
        'bots.update',
        'bots.delete',
        'calls.cancel',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency with external effect', () => {
    for (const c of openmicAiConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('openmic-ai bots.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/bots with name + prompt', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 'bot_new' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openmicAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'bots.create',
      args: { name: 'Concierge', prompt: 'Be polite.' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/bots')
    expect(requestBody).toMatchObject({ name: 'Concierge', prompt: 'Be polite.' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      openmicAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'bots.create',
        args: { name: 'Concierge', prompt: 'Be polite.' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('openmic-ai bots.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/bots/{botId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'bot_abc' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openmicAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'bots.update',
      args: { botId: 'bot_abc', prompt: 'Be even more polite.' },
      idempotencyKey: 'k-2',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/bots/bot_abc')
  })
})

describe('openmic-ai bots.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/bots/{botId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openmicAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'bots.delete',
      args: { botId: 'bot_abc' },
      idempotencyKey: 'k-3',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/bots/bot_abc')
  })
})

describe('openmic-ai calls.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/calls/{callId}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openmicAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.cancel',
      args: { callId: 'call_xyz' },
      idempotencyKey: 'k-4',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/calls/call_xyz/cancel')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      openmicAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.cancel',
        args: { callId: 'call_xyz' },
        idempotencyKey: 'k-4',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
