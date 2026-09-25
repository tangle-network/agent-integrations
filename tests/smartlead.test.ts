import { afterEach, describe, expect, it, vi } from 'vitest'
import { smartleadConnector } from '../src/connectors/adapters/smartlead.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_smartlead_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'smartlead',
    label: 'SmartLead test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'smartlead_secret' },
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

describe('smartlead campaigns.start', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("POSTs status=START to /v1/campaigns/{campaign_id}/status", async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartleadConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.start',
      args: { campaign_id: 123 },
      idempotencyKey: 'start-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/123/status?api_key=smartlead_secret')
    expect(capturedBody).toEqual({ status: 'START' })
    expect(result.status).toBe('committed')
  })
})

describe('smartlead campaigns.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs status=PAUSED to /v1/campaigns/{campaign_id}/status', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartleadConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.pause',
      args: { campaign_id: 7 },
      idempotencyKey: 'pause-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/7/status?api_key=smartlead_secret')
    expect(capturedBody).toEqual({ status: 'PAUSED' })
    expect(result.status).toBe('committed')
  })
})

describe('smartlead campaigns.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /v1/campaigns/{campaign_id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartleadConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.delete',
      args: { campaign_id: 55 },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/55?api_key=smartlead_secret')
    expect(result.status).toBe('committed')
  })
})

describe('smartlead leads.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/leads/{lead_id} with provided fields', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartleadConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.update',
      args: { lead_id: 99, first_name: 'Ada', email: 'ada@example.com' },
      idempotencyKey: 'upd-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/leads/99?api_key=smartlead_secret')
    expect(capturedBody).toMatchObject({ first_name: 'Ada', email: 'ada@example.com' })
    expect(result.status).toBe('committed')
  })
})

describe('smartlead leads.remove', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /v1/campaigns/{campaign_id}/leads/{lead_id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartleadConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.remove',
      args: { campaign_id: 12, lead_id: 99 },
      idempotencyKey: 'rem-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/12/leads/99?api_key=smartlead_secret')
    expect(result.status).toBe('committed')
  })
})
