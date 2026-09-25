import { afterEach, describe, expect, it, vi } from 'vitest'
import { insightoAiConnector } from '../src/connectors/adapters/insighto-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_insighto_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'insighto-ai',
    label: 'insighto-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'insighto_secret' },
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

describe('insighto-ai assistants.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/assistants with the assistant payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'asst_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.create',
      args: { name: 'Sales bot', provider: 'openai', model: 'gpt-4o' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/assistants')
    expect(requestBody).toMatchObject({ name: 'Sales bot', provider: 'openai', model: 'gpt-4o' })
  })
})

describe('insighto-ai assistants.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/assistants/{assistant_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.delete',
      args: { assistant_id: 'asst_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/assistants/asst_99')
  })
})

describe('insighto-ai campaigns.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/campaigns/{campaign_id}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ cancelled: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.cancel',
      args: { campaign_id: 'camp_7' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/campaigns/camp_7/cancel')
  })
})
