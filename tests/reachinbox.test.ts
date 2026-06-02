import { afterEach, describe, expect, it, vi } from 'vitest'
import { reachinboxConnector } from '../src/connectors/adapters/reachinbox.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_reachinbox_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'reachinbox',
    label: 'reachinbox test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'reachinbox_secret' },
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

describe('reachinbox adapter manifest', () => {
  it('classifies itself as the crm category and exposes the reachinbox kind', () => {
    expect(reachinboxConnector.manifest.kind).toBe('reachinbox')
    expect(reachinboxConnector.manifest.category).toBe('crm')
    expect(reachinboxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = reachinboxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/ReachInbox/i)
  })

  it('covers campaigns, leads, blocklist, warmup, email, schedule, templates, and inbox capabilities', () => {
    const names = reachinboxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'blocklist.add',
        'campaigns.create',
        'campaigns.delete',
        'campaigns.list',
        'campaigns.pause',
        'campaigns.start',
        'campaigns.summary',
        'email.add',
        'inbox.replies.fetch',
        'leads.add',
        'leads.remove',
        'leads.update',
        'schedule.set',
        'templates.list',
        'warmup.enable',
        'warmup.pause',
      ].sort(),
    )
    const mutations = reachinboxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'blocklist.add',
        'campaigns.create',
        'campaigns.delete',
        'campaigns.pause',
        'campaigns.start',
        'email.add',
        'leads.add',
        'leads.remove',
        'leads.update',
        'schedule.set',
        'warmup.enable',
        'warmup.pause',
      ].sort(),
    )
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['campaigns.create', 'campaigns.delete']) {
      const cap = reachinboxConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes templates.list and inbox.replies.fetch as reads', () => {
    const reads = reachinboxConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('templates.list')
    expect(reads).toContain('inbox.replies.fetch')
  })
})

describe('reachinbox campaigns.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/campaigns with the campaign body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'camp_new' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reachinboxConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.create',
      args: { name: 'Q3 outbound' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.reachinbox.xyz/api/v1/campaigns')
    expect(requestBody).toMatchObject({ name: 'Q3 outbound' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      reachinboxConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaigns.create',
        args: { name: 'X' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('reachinbox campaigns.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/campaigns/{campaignId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reachinboxConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.delete',
      args: { campaignId: 'camp_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.reachinbox.xyz/api/v1/campaigns/camp_42')
    expect(result.status).toBe('committed')
  })
})

describe('reachinbox templates.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/templates', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ templates: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reachinboxConnector.executeRead!({
      source: source(),
      capabilityName: 'templates.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/templates')
    expect(result.data).toEqual({ templates: [] })
  })
})

describe('reachinbox inbox.replies.fetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/unibox/replies', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ replies: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reachinboxConnector.executeRead!({
      source: source(),
      capabilityName: 'inbox.replies.fetch',
      args: { limit: 25 },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/unibox/replies')
    expect(String(requestUrl)).toContain('limit=25')
    expect(result.data).toEqual({ replies: [] })
  })
})
