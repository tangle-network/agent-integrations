import { afterEach, describe, expect, it, vi } from 'vitest'
import { vboutConnector } from '../src/connectors/adapters/vbout.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vbout_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vbout',
    label: 'vbout test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'vbout_secret' },
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

describe('vbout adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vbout kind', () => {
    expect(vboutConnector.manifest.kind).toBe('vbout')
    expect(vboutConnector.manifest.category).toBe('crm')
    expect(vboutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with VBOUT-specific hint', () => {
    const auth = vboutConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/VBOUT/i)
  })

  it('covers contacts, tags, lists, campaigns, and social messaging capability surface', () => {
    const names = vboutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.get')
    expect(names).toContain('contacts.list')
    expect(names).toContain('contacts.create')
    expect(names).toContain('contacts.update')
    expect(names).toContain('contacts.unsubscribe')
    expect(names).toContain('contacts.delete')
    expect(names).toContain('tags.add')
    expect(names).toContain('tags.remove')
    expect(names).toContain('lists.get')
    expect(names).toContain('lists.create')
    expect(names).toContain('lists.delete')
    expect(names).toContain('campaigns.create')
    expect(names).toContain('campaigns.send')
    expect(names).toContain('campaigns.delete')
    expect(names).toContain('social.messages.create')
  })

  it('marks mutating operations as mutations', () => {
    const mutations = vboutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('contacts.create')
    expect(mutations).toContain('contacts.update')
    expect(mutations).toContain('contacts.unsubscribe')
    expect(mutations).toContain('contacts.delete')
    expect(mutations).toContain('tags.add')
    expect(mutations).toContain('tags.remove')
    expect(mutations).toContain('lists.create')
    expect(mutations).toContain('lists.delete')
    expect(mutations).toContain('campaigns.create')
    expect(mutations).toContain('campaigns.send')
    expect(mutations).toContain('campaigns.delete')
    expect(mutations).toContain('social.messages.create')
  })

  it('marks read-only operations as read', () => {
    const reads = vboutConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('contacts.get')
    expect(reads).toContain('contacts.list')
    expect(reads).toContain('lists.get')
  })

  it('marks new write-side mutations as native-idempotency external effect', () => {
    const expected = ['contacts.delete', 'lists.delete', 'campaigns.send', 'campaigns.delete']
    for (const name of expected) {
      const cap = vboutConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('vbout contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/contacts/delete with the contact email', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { email: 'gone@example.com' },
      idempotencyKey: 'k-cd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/1/contacts/delete')
    expect(requestBody).toMatchObject({ email: 'gone@example.com' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      vboutConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { email: 'gone@example.com' },
        idempotencyKey: 'k-cd-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('vbout lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/lists/delete with the list id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { id: 'list_77' },
      idempotencyKey: 'k-ld-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/lists/delete')
    expect(requestBody).toMatchObject({ id: 'list_77' })
  })
})

describe('vbout campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/campaigns/send with the campaign id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ queued: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { id: 'camp_1', schedule: '2026-06-10T12:00:00Z' },
      idempotencyKey: 'k-cs-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/campaigns/send')
    expect(requestBody).toMatchObject({ id: 'camp_1', schedule: '2026-06-10T12:00:00Z' })
  })
})

describe('vbout campaigns.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/campaigns/delete with the campaign id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.delete',
      args: { id: 'camp_9' },
      idempotencyKey: 'k-cdel-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/campaigns/delete')
    expect(requestBody).toMatchObject({ id: 'camp_9' })
  })
})
