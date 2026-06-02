import { afterEach, describe, expect, it, vi } from 'vitest'
import { instantlyAiConnector } from '../src/connectors/adapters/instantly-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_instantly_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'instantly-ai',
    label: 'instantly-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'instantly_secret' },
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

describe('instantly-ai adapter manifest', () => {
  it('classifies itself as the crm category and exposes the instantly-ai kind', () => {
    expect(instantlyAiConnector.manifest.kind).toBe('instantly-ai')
    expect(instantlyAiConnector.manifest.category).toBe('crm')
    expect(instantlyAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = instantlyAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the new lead/campaign mutations', () => {
    const names = instantlyAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'campaigns.create',
        'campaigns.pause',
        'campaigns.resume',
        'campaigns.search',
        'lead-lists.create',
        'leads.add-to-campaign',
        'leads.delete',
        'leads.search',
      ].sort(),
    )
    const reads = instantlyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = instantlyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['campaigns.search', 'leads.search'].sort())
    expect(mutations).toEqual(
      [
        'campaigns.create',
        'campaigns.pause',
        'campaigns.resume',
        'lead-lists.create',
        'leads.add-to-campaign',
        'leads.delete',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['leads.delete', 'campaigns.pause', 'campaigns.resume']
    for (const name of expected) {
      const cap = instantlyAiConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('instantly-ai leads.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v2/leads/{lead_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await instantlyAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.delete',
      args: { lead_id: 'lead_42' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.instantly.ai/api/v2/leads/lead_42')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      instantlyAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'leads.delete',
        args: { lead_id: 'lead_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('instantly-ai campaigns.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/campaigns/{campaign_id}/pause', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ paused: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await instantlyAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.pause',
      args: { campaign_id: 'camp_7' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.instantly.ai/api/v2/campaigns/camp_7/pause')
  })
})

describe('instantly-ai campaigns.resume', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/campaigns/{campaign_id}/activate', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ resumed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await instantlyAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.resume',
      args: { campaign_id: 'camp_7' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.instantly.ai/api/v2/campaigns/camp_7/activate')
  })
})
