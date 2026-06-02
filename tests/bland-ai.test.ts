import { afterEach, describe, expect, it, vi } from 'vitest'
import { blandAiConnector } from '../src/connectors/adapters/bland-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bland_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bland-ai',
    label: 'Bland test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bland_secret' },
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

describe('bland-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the bland-ai kind', () => {
    expect(blandAiConnector.manifest.kind).toBe('bland-ai')
    expect(blandAiConnector.manifest.category).toBe('comms')
    expect(blandAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = blandAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send/get/list + cancel/stop + pathways.create', () => {
    const names = blandAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.cancel',
        'calls.get',
        'calls.list',
        'calls.send',
        'calls.stop',
        'pathways.create',
      ].sort(),
    )
    const reads = blandAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = blandAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['calls.get', 'calls.list'])
    expect(mutations).toEqual(['calls.cancel', 'calls.send', 'calls.stop', 'pathways.create'].sort())
  })

  it('marks every new mutation as native-idempotency external effect', () => {
    const newMutations = new Set(['calls.cancel', 'calls.stop', 'pathways.create'])
    for (const c of blandAiConnector.manifest.capabilities) {
      if (!newMutations.has(c.name)) continue
      expect(c.class).toBe('mutation')
      if (c.class !== 'mutation') throw new Error('unreachable')
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('bland-ai adapter write execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs calls.cancel at the call-scoped cancel path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await blandAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.cancel',
      args: { callId: 'call_42' },
      idempotencyKey: 'idem_c',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bland.ai/v1/calls/call_42/cancel')
  })

  it('POSTs calls.stop at the call-scoped stop path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'stopped' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await blandAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.stop',
      args: { callId: 'call_99' },
      idempotencyKey: 'idem_s',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bland.ai/v1/calls/call_99/stop')
  })

  it('POSTs pathways.create with the renamed body', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ id: 'pw_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await blandAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'pathways.create',
      args: {
        name: 'Lead qual',
        description: 'A simple qualification flow',
        nodes: [{ id: 'n1' }],
        edges: [{ from: 'n1', to: 'n2' }],
      },
      idempotencyKey: 'idem_p',
    })

    expect(requestUrl).toBe('https://api.bland.ai/v1/pathway/create')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      name: 'Lead qual',
      description: 'A simple qualification flow',
      nodes: [{ id: 'n1' }],
      edges: [{ from: 'n1', to: 'n2' }],
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      blandAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.stop',
        args: { callId: 'call_x' },
        idempotencyKey: 'idem_x',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
