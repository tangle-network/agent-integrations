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

describe('smartlead adapter manifest', () => {
  it('classifies itself as the crm category and exposes the smartlead kind', () => {
    expect(smartleadConnector.manifest.kind).toBe('smartlead')
    expect(smartleadConnector.manifest.category).toBe('crm')
    expect(smartleadConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a SmartLead-specific hint', () => {
    const auth = smartleadConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SmartLead/i)
  })

  it('covers campaigns and leads capability surface', () => {
    const names = smartleadConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('campaigns.create')
    expect(names).toContain('campaigns.statistics')
    expect(names).toContain('campaigns.update')
    expect(names).toContain('campaigns.start')
    expect(names).toContain('campaigns.pause')
    expect(names).toContain('campaigns.delete')
    expect(names).toContain('leads.add')
    expect(names).toContain('leads.update')
    expect(names).toContain('leads.remove')
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = smartleadConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('campaigns.create')
    expect(mutations).toContain('campaigns.update')
    expect(mutations).toContain('campaigns.start')
    expect(mutations).toContain('campaigns.pause')
    expect(mutations).toContain('campaigns.delete')
    expect(mutations).toContain('leads.add')
    expect(mutations).toContain('leads.update')
    expect(mutations).toContain('leads.remove')
  })

  it('marks read-only operations as read', () => {
    const reads = smartleadConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('campaigns.statistics')
  })

  it('marks the new mutations as native-idempotency external effect', () => {
    const targets = [
      'campaigns.start',
      'campaigns.pause',
      'campaigns.delete',
      'leads.update',
      'leads.remove',
    ]
    for (const name of targets) {
      const cap = smartleadConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/123/status')
    expect(capturedBody).toEqual({ status: 'START' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      smartleadConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaigns.start',
        args: { campaign_id: 123 },
        idempotencyKey: 'start-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/7/status')
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
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/55')
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
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/leads/99')
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
    expect(capturedUrl).toBe('https://api.smartlead.io/v1/campaigns/12/leads/99')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      smartleadConnector.executeMutation!({
        source: source(),
        capabilityName: 'leads.remove',
        args: { campaign_id: 12, lead_id: 99 },
        idempotencyKey: 'rem-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
