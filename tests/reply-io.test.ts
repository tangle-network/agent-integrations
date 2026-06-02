import { afterEach, describe, expect, it, vi } from 'vitest'
import { replyIoConnector } from '../src/connectors/adapters/reply-io.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_reply_io_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'reply-io',
    label: 'Reply.io test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'reply_secret' },
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

describe('reply-io adapter manifest', () => {
  it('classifies itself as the crm category and exposes the reply-io kind', () => {
    expect(replyIoConnector.manifest.kind).toBe('reply-io')
    expect(replyIoConnector.manifest.category).toBe('crm')
    expect(replyIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = replyIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the contacts action set plus campaigns + templates write-side capabilities', () => {
    const names = replyIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.push_to_campaign',
        'contacts.create_and_push',
        'contacts.get',
        'contacts.mark_replied',
        'contacts.mark_finished',
        'contacts.remove_from_campaign',
        'contacts.remove_from_all_campaigns',
        'contacts.delete',
        'campaigns.list',
        'campaigns.start',
        'campaigns.pause',
        'templates.create',
      ].sort(),
    )
    const reads = replyIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = replyIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.get', 'campaigns.list'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.push_to_campaign',
        'contacts.create_and_push',
        'contacts.mark_replied',
        'contacts.mark_finished',
        'contacts.remove_from_campaign',
        'contacts.remove_from_all_campaigns',
        'contacts.delete',
        'campaigns.start',
        'campaigns.pause',
        'templates.create',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect', () => {
    for (const c of replyIoConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('reply-io campaigns + templates execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /campaigns for campaigns.list with bearer credential', async () => {
    let url: string | undefined
    let method: string | undefined
    let auth: string | null | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      method = init?.method
      auth = new Headers(init?.headers).get('authorization')
      return jsonResponse([{ id: 'c_1', name: 'Q1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await replyIoConnector.executeRead!({
      source: source(),
      capabilityName: 'campaigns.list',
      args: {},
      idempotencyKey: 'k-list',
    })
    expect(result.data).toEqual([{ id: 'c_1', name: 'Q1' }])
    expect(method).toBe('GET')
    expect(url).toContain('https://api.reply.io/v1/campaigns')
    expect(auth).toBe('Bearer reply_secret')
  })

  it('POSTs campaigns.start at /campaigns/{campaignId}/start', async () => {
    let url: string | undefined
    let method: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      method = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await replyIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.start',
      args: { campaignId: 'camp_42' },
      idempotencyKey: 'k-start',
    })
    expect(result.status).toBe('committed')
    expect(method).toBe('POST')
    expect(url).toContain('/campaigns/camp_42/start')
  })

  it('POSTs campaigns.pause at /campaigns/{campaignId}/pause', async () => {
    let url: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await replyIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.pause',
      args: { campaignId: 'camp_99' },
      idempotencyKey: 'k-pause',
    })
    expect(result.status).toBe('committed')
    expect(url).toContain('/campaigns/camp_99/pause')
  })

  it('POSTs templates.create with name/subject/body', async () => {
    let url: string | undefined
    let body: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      body = init?.body ? String(init.body) : undefined
      return jsonResponse({ id: 'tpl_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await replyIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'templates.create',
      args: { name: 'Intro', subject: 'Hello', body: '<p>Hi</p>' },
      idempotencyKey: 'k-tpl',
    })
    expect(result.status).toBe('committed')
    expect(url).toContain('/emailTemplates')
    expect(JSON.parse(body ?? '{}')).toEqual({
      name: 'Intro',
      subject: 'Hello',
      body: '<p>Hi</p>',
    })
  })

  it('surfaces CredentialsExpired on 401 for campaigns.start', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('expired', { status: 401 })))
    await expect(
      replyIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaigns.start',
        args: { campaignId: 'camp_42' },
        idempotencyKey: 'k-start-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
