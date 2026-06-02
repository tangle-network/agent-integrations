import { afterEach, describe, expect, it, vi } from 'vitest'
import { woodpeckerConnector } from '../src/connectors/adapters/woodpecker.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_woodpecker_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'woodpecker',
    label: 'Woodpecker test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'woodpecker_secret' },
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

describe('woodpecker adapter manifest', () => {
  it('classifies itself as the crm category and exposes the woodpecker kind', () => {
    expect(woodpeckerConnector.manifest.kind).toBe('woodpecker')
    expect(woodpeckerConnector.manifest.category).toBe('crm')
    expect(woodpeckerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = woodpeckerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers prospect lifecycle, domain blacklist, and campaign reads', () => {
    const names = woodpeckerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'campaigns.list',
        'domain.blacklist',
        'prospect.add-to-campaign',
        'prospect.add-to-list',
        'prospect.find-by-email',
        'prospect.get-responses',
        'prospect.remove-from-campaign',
        'prospect.stop',
        'prospect.update',
      ].sort(),
    )
    const reads = woodpeckerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['campaigns.list', 'prospect.find-by-email', 'prospect.get-responses'].sort(),
    )
  })

  it('marks newly added mutations as native-idempotency with externalEffect=true', () => {
    const newMutations = new Set([
      'prospect.update',
      'prospect.remove-from-campaign',
      'prospect.stop',
    ])
    for (const cap of woodpeckerConnector.manifest.capabilities) {
      if (!newMutations.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('woodpecker write capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prospect.update POSTs to /prospect with update=true and a body containing only supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ status: 'OK' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await woodpeckerConnector.executeMutation!({
      source: source(),
      capabilityName: 'prospect.update',
      args: { email: 'a@b.com', first_name: 'Ada' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/prospect')
    expect(String(requestUrl)).toContain('update=true')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed).toEqual({ email: 'a@b.com', first_name: 'Ada' })
  })

  it('prospect.remove-from-campaign DELETEs with id and campaigns_id query', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'OK' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woodpeckerConnector.executeMutation!({
      source: source(),
      capabilityName: 'prospect.remove-from-campaign',
      args: { prospectId: 12345, campaignId: 'CAMP-1' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/prospect/campaign')
    expect(String(requestUrl)).toContain('id=12345')
    expect(String(requestUrl)).toContain('campaigns_id=CAMP-1')
  })

  it('prospect.stop POSTs to /prospect/stop_followups with body containing email + optional campaign_id', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body as string | undefined
      return jsonResponse({ status: 'OK' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await woodpeckerConnector.executeMutation!({
      source: source(),
      capabilityName: 'prospect.stop',
      args: { email: 'a@b.com', campaign_id: 'CAMP-1' },
      idempotencyKey: 'k-3',
    })

    expect(String(requestUrl)).toContain('/prospect/stop_followups')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed).toEqual({ email: 'a@b.com', campaign_id: 'CAMP-1' })
  })

  it('campaigns.list issues a GET on /campaign_list and forwards a status filter', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 'c1', name: 'Outreach Q1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await woodpeckerConnector.executeRead!({
      source: source(),
      capabilityName: 'campaigns.list',
      args: { status: 'RUNNING' },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/campaign_list')
    expect(String(requestUrl)).toContain('status=RUNNING')
    expect(result.data).toEqual([{ id: 'c1', name: 'Outreach Q1' }])
  })

  it('surfaces CredentialsExpired on 401 from a write capability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )

    await expect(
      woodpeckerConnector.executeMutation!({
        source: source(),
        capabilityName: 'prospect.stop',
        args: { email: 'a@b.com' },
        idempotencyKey: 'k-5',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
