import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollybotAiConnector } from '../src/connectors/adapters/pollybot-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pollybot_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pollybot-ai',
    label: 'pollybot-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pollybot_secret' },
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

describe('pollybot-ai leads.tag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the tag to /chatbots/{chatbotId}/leads/{leadId}/tags', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 'tag_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pollybotAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.tag',
      args: { chatbotId: 'cb_1', leadId: 'ld_1', tag: 'priority' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.pollybot.ai/v1/chatbots/cb_1/leads/ld_1/tags')
    expect(requestBody).toMatchObject({ tag: 'priority' })
    expect(result.status).toBe('committed')
  })
})

describe('pollybot-ai leads.bulk-import', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the leads array to /chatbots/{chatbotId}/leads/bulk', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ accepted: 2 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await pollybotAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.bulk-import',
      args: {
        chatbotId: 'cb_1',
        leads: [{ name: 'A', email: 'a@x' }, { name: 'B', email: 'b@x' }],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://api.pollybot.ai/v1/chatbots/cb_1/leads/bulk')
    expect(requestBody).toMatchObject({ leads: [{ name: 'A' }, { name: 'B' }] })
  })
})

describe('pollybot-ai campaigns.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /chatbots/{chatbotId}/campaigns', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await pollybotAiConnector.executeRead!({
      source: source(),
      capabilityName: 'campaigns.list',
      args: { chatbotId: 'cb_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://api.pollybot.ai/v1/chatbots/cb_1/campaigns')
  })
})

describe('pollybot-ai campaigns.start', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /chatbots/{chatbotId}/campaigns/{campaignId}/start', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'started' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pollybotAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.start',
      args: { chatbotId: 'cb_1', campaignId: 'cm_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.pollybot.ai/v1/chatbots/cb_1/campaigns/cm_1/start')
    expect(result.status).toBe('committed')
  })
})
