import { afterEach, describe, expect, it, vi } from 'vitest'
import { instasentConnector } from '../src/connectors/adapters/instasent.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_instasent_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'instasent',
    label: 'Instasent test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'instasent_secret' },
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

describe('instasent adapter manifest', () => {
  it('classifies itself as the crm category and exposes the instasent kind', () => {
    expect(instasentConnector.manifest.kind).toBe('instasent')
    expect(instasentConnector.manifest.category).toBe('crm')
    expect(instasentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = instasentConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus messaging surface (sms + campaign)', () => {
    const names = instasentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.add_or_update',
        'events.create',
        'contacts.delete',
        'sms.send',
        'campaign.create',
        'campaign.cancel',
      ].sort(),
    )
    const mutations = instasentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.add_or_update',
        'events.create',
        'contacts.delete',
        'sms.send',
        'campaign.create',
        'campaign.cancel',
      ].sort(),
    )
  })

  it('marks new write-side mutations native-idempotency + externalEffect', () => {
    const newMutationNames = ['sms.send', 'campaign.create', 'campaign.cancel']
    for (const name of newMutationNames) {
      const cap = instasentConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `cap ${name}`).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class !== 'mutation') continue
      expect(cap!.cas).toBe('native-idempotency')
      expect(cap!.externalEffect).toBe(true)
    }
  })
})

describe('instasent sms.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/sms/send with from/to/text and returns a committed mutation result', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sms-1', status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await instasentConnector.executeMutation!({
      source: source(),
      capabilityName: 'sms.send',
      args: { from: 'BRAND', to: '+34666112233', text: 'Hi there' },
      idempotencyKey: 'idemp-sms-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/sms/send')
    expect(requestBody).toMatchObject({ from: 'BRAND', to: '+34666112233', text: 'Hi there' })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.idempotentReplay).toBe(false)
    expect(result.data).toMatchObject({ id: 'sms-1' })
  })

  it('rejects when required `from` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      instasentConnector.executeMutation!({
        source: source(),
        capabilityName: 'sms.send',
        args: { to: '+34666112233', text: 'Hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: from/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      instasentConnector.executeMutation!({
        source: source(),
        capabilityName: 'sms.send',
        args: { from: 'BRAND', to: '+34666112233', text: 'Hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('instasent campaign.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/campaigns with the campaign payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'camp-1', status: 'scheduled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await instasentConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.create',
      args: {
        name: 'Spring promo',
        from: 'BRAND',
        text: 'Get 20% off',
        datasourceId: 'ds-1',
      },
      idempotencyKey: 'idemp-camp-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/campaigns')
    expect(requestBody).toMatchObject({
      name: 'Spring promo',
      from: 'BRAND',
      text: 'Get 20% off',
      datasourceId: 'ds-1',
    })
    expect(result.status).toBe('committed')
  })
})

describe('instasent campaign.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/campaigns/{id}', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'camp-1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await instasentConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.cancel',
      args: { campaignId: 'camp-1' },
      idempotencyKey: 'idemp-cancel-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/campaigns/camp-1')
    expect(result.status).toBe('committed')
  })
})
