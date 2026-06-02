import { afterEach, describe, expect, it, vi } from 'vitest'
import { dittofeedConnector } from '../src/connectors/adapters/dittofeed.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_dittofeed_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'dittofeed',
    label: 'dittofeed test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'dittofeed_secret' },
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

describe('dittofeed adapter manifest', () => {
  it('classifies itself as the crm category and exposes the dittofeed kind', () => {
    expect(dittofeedConnector.manifest.kind).toBe('dittofeed')
    expect(dittofeedConnector.manifest.category).toBe('crm')
    expect(dittofeedConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = dittofeedConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the new write-side mutations', () => {
    const names = dittofeedConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'events.track',
        'screens.record',
        'users.identify',
        'subscribers.create',
        'subscribers.delete',
        'broadcast.send',
        'journey.trigger',
      ].sort(),
    )
    const mutations = dittofeedConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'events.track',
        'screens.record',
        'users.identify',
        'subscribers.create',
        'subscribers.delete',
        'broadcast.send',
        'journey.trigger',
      ].sort(),
    )
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['subscribers.create', 'subscribers.delete', 'broadcast.send', 'journey.trigger']
    for (const name of expected) {
      const cap = dittofeedConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('dittofeed subscribers.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/public/apps/identify with subscriber traits', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await dittofeedConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.create',
      args: { userId: 'u_1', email: 'a@example.com' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://dittofeed.com/api/public/apps/identify')
    expect(requestBody).toMatchObject({ userId: 'u_1' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      dittofeedConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.create',
        args: { userId: 'u_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('dittofeed subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('emits a Subscription Cancelled track event', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await dittofeedConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { userId: 'u_1', subscriptionGroupId: 'sg_42' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://dittofeed.com/api/public/apps/track')
    expect(requestBody).toMatchObject({ userId: 'u_1', event: 'Subscription Cancelled' })
  })
})

describe('dittofeed broadcast.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/admin/broadcasts/trigger with broadcastId', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await dittofeedConnector.executeMutation!({
      source: source(),
      capabilityName: 'broadcast.send',
      args: { broadcastId: 'b_1' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://dittofeed.com/api/admin/broadcasts/trigger')
    expect(requestBody).toMatchObject({ broadcastId: 'b_1' })
  })
})

describe('dittofeed journey.trigger', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/admin/journeys/trigger with journeyId+userId', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await dittofeedConnector.executeMutation!({
      source: source(),
      capabilityName: 'journey.trigger',
      args: { journeyId: 'j_1', userId: 'u_1' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://dittofeed.com/api/admin/journeys/trigger')
    expect(requestBody).toMatchObject({ journeyId: 'j_1', userId: 'u_1' })
  })
})
