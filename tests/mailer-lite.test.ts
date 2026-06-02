import { afterEach, describe, expect, it, vi } from 'vitest'
import { mailerLiteConnector } from '../src/connectors/adapters/mailer-lite.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_mailer_lite_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'mailer-lite',
    label: 'mailer-lite test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'mailer_lite_secret' },
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

describe('mailer-lite adapter manifest', () => {
  it('classifies itself as the crm category and exposes the mailer-lite kind', () => {
    expect(mailerLiteConnector.manifest.kind).toBe('mailer-lite')
    expect(mailerLiteConnector.manifest.category).toBe('crm')
    expect(mailerLiteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mailerLiteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new write-side mutations', () => {
    const names = mailerLiteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.upsert',
        'subscribers.groups.add',
        'subscribers.groups.remove',
        'subscribers.find',
        'subscribers.delete',
        'campaigns.create',
        'campaigns.schedule',
      ].sort(),
    )
    const reads = mailerLiteConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mailerLiteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['subscribers.find'])
    expect(mutations).toEqual(
      [
        'subscribers.upsert',
        'subscribers.groups.add',
        'subscribers.groups.remove',
        'subscribers.delete',
        'campaigns.create',
        'campaigns.schedule',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['subscribers.delete', 'campaigns.create', 'campaigns.schedule']
    for (const name of expected) {
      const cap = mailerLiteConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('mailer-lite subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /subscribers/{subscriberId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mailerLiteConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { subscriberId: 'sub_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://connect.mailerlite.com/api/subscribers/sub_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      mailerLiteConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.delete',
        args: { subscriberId: 'sub_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('mailer-lite campaigns.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /campaigns with the campaign payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { id: 'camp_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await mailerLiteConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.create',
      args: {
        name: 'Welcome',
        type: 'regular',
        emails: [{ subject: 'hi', from: 'a@b.io', from_name: 'A', content: '<p>hi</p>' }],
        groups: ['grp_1'],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://connect.mailerlite.com/api/campaigns')
    expect(requestBody).toMatchObject({ name: 'Welcome', type: 'regular' })
  })
})

describe('mailer-lite campaigns.schedule', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /campaigns/{campaignId}/schedule with the delivery payload', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ scheduled: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await mailerLiteConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.schedule',
      args: {
        campaignId: 'camp_1',
        delivery: 'scheduled',
        schedule: { date: '2026-12-01T10:00:00Z' },
      },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://connect.mailerlite.com/api/campaigns/camp_1/schedule')
    expect(requestBody).toMatchObject({ delivery: 'scheduled' })
  })
})
