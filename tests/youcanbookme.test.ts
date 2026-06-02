import { afterEach, describe, expect, it, vi } from 'vitest'
import { youcanbookmeConnector } from '../src/connectors/adapters/youcanbookme.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_youcanbookme_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'youcanbookme',
    label: 'youcanbookme test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'youcanbookme_secret' },
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

describe('youcanbookme adapter manifest', () => {
  it('classifies itself as the crm category and exposes the youcanbookme kind', () => {
    expect(youcanbookmeConnector.manifest.kind).toBe('youcanbookme')
    expect(youcanbookmeConnector.manifest.category).toBe('crm')
    expect(youcanbookmeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = youcanbookmeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus write-side extensions', () => {
    const names = youcanbookmeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'profiles.create',
        'profiles.update',
        'profiles.delete',
        'bookings.retrieve',
        'bookings.cancel',
        'bookings.reschedule',
      ].sort(),
    )
    const reads = youcanbookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = youcanbookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['bookings.retrieve'])
    expect(mutations).toEqual(
      [
        'profiles.create',
        'profiles.update',
        'profiles.delete',
        'bookings.cancel',
        'bookings.reschedule',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set([
      'profiles.update',
      'profiles.delete',
      'bookings.cancel',
      'bookings.reschedule',
    ])
    const caps = youcanbookmeConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('youcanbookme bookings.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/bookings/{bookingId}/cancel with reason body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'b_1', cancelled: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await youcanbookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'bookings.cancel',
      args: { bookingId: 'b_1', reason: 'no-show' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/bookings/b_1/cancel')
    expect(requestBody).toMatchObject({ bookingId: 'b_1', reason: 'no-show' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      youcanbookmeConnector.executeMutation!({
        source: source(),
        capabilityName: 'bookings.cancel',
        args: { bookingId: 'b_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('youcanbookme bookings.reschedule', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/bookings/{bookingId}/reschedule with new slot body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'b_2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await youcanbookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'bookings.reschedule',
      args: { bookingId: 'b_2', startsAt: '2026-07-01T10:00:00Z', endsAt: '2026-07-01T10:30:00Z' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('/v1/bookings/b_2/reschedule')
    expect(requestBody).toMatchObject({
      bookingId: 'b_2',
      startsAt: '2026-07-01T10:00:00Z',
      endsAt: '2026-07-01T10:30:00Z',
    })
  })
})

describe('youcanbookme profiles.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/profiles/{profileId} with the merged args body', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'prof_9' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await youcanbookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'profiles.update',
      args: { profileId: 'prof_9', title: 'Updated', timeZone: 'America/New_York' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/profiles/prof_9')
    expect(requestBody).toMatchObject({ profileId: 'prof_9', title: 'Updated', timeZone: 'America/New_York' })
  })
})

describe('youcanbookme profiles.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/profiles/{profileId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await youcanbookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'profiles.delete',
      args: { profileId: 'prof_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/profiles/prof_9')
    expect(result.status).toBe('committed')
  })
})
