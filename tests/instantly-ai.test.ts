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
