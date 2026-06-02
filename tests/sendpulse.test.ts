import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendpulseConnector } from '../src/connectors/adapters/sendpulse.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sendpulse_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sendpulse',
    label: 'sendpulse test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'sp_token', refreshToken: 'sp_refresh' },
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

describe('sendpulse adapter manifest', () => {
  it('classifies itself as the comms category and exposes the sendpulse kind', () => {
    expect(sendpulseConnector.manifest.kind).toBe('sendpulse')
    expect(sendpulseConnector.manifest.category).toBe('comms')
    expect(sendpulseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with SendPulse oauth endpoints', () => {
    const auth = sendpulseConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://login.sendpulse.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.sendpulse.com/oauth/access_token')
    expect(auth.clientIdEnv).toBe('SENDPULSE_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SENDPULSE_CLIENT_SECRET')
  })

  it('covers addressbook lifecycle, campaign lifecycle, and subscriber capability surface', () => {
    const names = sendpulseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'addressbooks.create',
      'addressbooks.delete',
      'addressbooks.list',
      'campaigns.cancel',
      'campaigns.create',
      'subscriber.add',
      'subscriber.delete',
      'subscriber.get',
      'subscriber.unsubscribe',
      'subscriber.update',
      'subscriber.variable.update',
    ])
  })

  it('marks subscriber mutations with appropriate cas strategies', () => {
    const mutations = sendpulseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .sort((a, b) => a.name.localeCompare(b.name))

    const mutationMap = new Map(mutations.map((m) => [m.name, m]))

    expect(mutationMap.get('subscriber.add')?.cas).toBe('native-idempotency')
    expect(mutationMap.get('subscriber.update')?.cas).toBe('etag-if-match')
    expect(mutationMap.get('subscriber.delete')?.cas).toBe('optimistic-read-verify')
    expect(mutationMap.get('subscriber.unsubscribe')?.cas).toBe('optimistic-read-verify')
    expect(mutationMap.get('subscriber.variable.update')?.cas).toBe('optimistic-read-verify')
  })

  it('marks the new lifecycle mutations as native-idempotency external-effect', () => {
    for (const name of [
      'addressbooks.create',
      'addressbooks.delete',
      'campaigns.create',
      'campaigns.cancel',
    ]) {
      const cap = sendpulseConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes read capabilities for addressbooks and subscriber retrieval', () => {
    const reads = sendpulseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['addressbooks.list', 'subscriber.get'])
  })
})

describe('sendpulse addressbooks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/addressbooks with bookName in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 1234 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendpulseConnector.executeMutation!({
      source: source(),
      capabilityName: 'addressbooks.create',
      args: { bookName: 'Q3 Leads' },
      idempotencyKey: 'k-ab-create',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/addressbooks')
    expect(requestBody).toEqual({ bookName: 'Q3 Leads' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sendpulseConnector.executeMutation!({
        source: source(),
        capabilityName: 'addressbooks.create',
        args: { bookName: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sendpulse addressbooks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/addressbooks/{addressbookId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendpulseConnector.executeMutation!({
      source: source(),
      capabilityName: 'addressbooks.delete',
      args: { addressbookId: 'ab_42' },
      idempotencyKey: 'k-ab-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/addressbooks/ab_42')
  })
})

describe('sendpulse campaigns.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/campaigns with the args as the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'campaign_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = {
      sender_name: 'Marketing',
      sender_email: 'no-reply@example.com',
      subject: 'Welcome',
      body: 'PGgxPmhpPC9oMT4=',
      list_id: 'ab_42',
    }
    const result = await sendpulseConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.create',
      args,
      idempotencyKey: 'k-camp-create',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/campaigns')
    expect(requestBody).toEqual(args)
  })
})

describe('sendpulse campaigns.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/campaigns/{campaignId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendpulseConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.cancel',
      args: { campaignId: 'camp_99' },
      idempotencyKey: 'k-camp-cancel',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/campaigns/camp_99')
  })
})
