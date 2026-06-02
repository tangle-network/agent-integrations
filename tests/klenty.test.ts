import { afterEach, describe, expect, it, vi } from 'vitest'
import { klentyConnector } from '../src/connectors/adapters/klenty.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_klenty_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'klenty',
    label: 'Klenty test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'klenty_secret' },
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

describe('klenty adapter manifest', () => {
  it('classifies itself as the crm category and exposes the klenty kind', () => {
    expect(klentyConnector.manifest.kind).toBe('klenty')
    expect(klentyConnector.manifest.category).toBe('crm')
    expect(klentyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = klentyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the prospect surface plus add/remove/pause cadence actions', () => {
    const names = klentyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'prospect.get',
        'prospect.create',
        'prospect.update',
        'prospect.add.to.campaign',
        'prospect.remove.from.campaign',
        'cadence.pause',
      ].sort(),
    )
    const reads = klentyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = klentyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['prospect.get'])
    expect(mutations).toEqual(
      [
        'prospect.add.to.campaign',
        'prospect.create',
        'prospect.update',
        'prospect.remove.from.campaign',
        'cadence.pause',
      ].sort(),
    )
  })

  it('marks new write-side mutations native-idempotency + externalEffect', () => {
    const newMutations = ['prospect.remove.from.campaign', 'cadence.pause']
    for (const name of newMutations) {
      const cap = klentyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `cap ${name}`).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class !== 'mutation') continue
      expect(cap!.cas).toBe('native-idempotency')
      expect(cap!.externalEffect).toBe(true)
    }
  })
})

describe('klenty prospect.remove.from.campaign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /apis/v1/user/{username}/stopCadence with email + cadenceName body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'removed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await klentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'prospect.remove.from.campaign',
      args: {
        username: 'rep@acme.com',
        email: 'lead@example.com',
        cadenceName: 'Q1 outbound',
      },
      idempotencyKey: 'idemp-remove-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/apis/v1/user/rep%40acme.com/stopCadence')
    expect(requestBody).toMatchObject({ email: 'lead@example.com', cadenceName: 'Q1 outbound' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      klentyConnector.executeMutation!({
        source: source(),
        capabilityName: 'prospect.remove.from.campaign',
        args: { username: 'rep@acme.com', email: 'lead@example.com', cadenceName: 'X' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('klenty cadence.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /apis/v1/user/{username}/pauseCadence with email + cadenceName body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'paused' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await klentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'cadence.pause',
      args: {
        username: 'rep@acme.com',
        email: 'lead@example.com',
        cadenceName: 'Q1 outbound',
      },
      idempotencyKey: 'idemp-pause-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/apis/v1/user/rep%40acme.com/pauseCadence')
    expect(requestBody).toMatchObject({ email: 'lead@example.com', cadenceName: 'Q1 outbound' })
    expect(result.status).toBe('committed')
  })
})
