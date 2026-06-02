import { afterEach, describe, expect, it, vi } from 'vitest'
import { savvycalConnector } from '../src/connectors/adapters/savvycal.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_savvycal_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'savvycal',
    label: 'savvycal test',
    consistencyModel: 'authoritative',
    scopes: ['read', 'write'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'savvycal_access_token' },
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

describe('savvycal adapter manifest', () => {
  it('classifies itself as the doc category and exposes the savvycal kind', () => {
    expect(savvycalConnector.manifest.kind).toBe('savvycal')
    expect(savvycalConnector.manifest.category).toBe('doc')
    expect(savvycalConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with proper scopes', () => {
    const auth = savvycalConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toContain('read')
    expect(auth.scopes).toContain('write')
  })

  it('covers user, events, links, and workflow capability surface', () => {
    const names = savvycalConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('user.current')
    expect(names).toContain('events.list')
    expect(names).toContain('events.get')
    expect(names).toContain('events.create')
    expect(names).toContain('events.update')
    expect(names).toContain('events.cancel')
    expect(names).toContain('events.findByEmail')
    expect(names).toContain('links.list')
    expect(names).toContain('links.get')
    expect(names).toContain('links.create')
    expect(names).toContain('links.update')
    expect(names).toContain('links.delete')
    expect(names).toContain('links.duplicate')
    expect(names).toContain('links.toggle')
    expect(names).toContain('links.slots')
    expect(names).toContain('workflows.list')
    expect(names).toContain('workflows.rules')
    expect(names).toContain('workflows.create')
  })

  it('classifies mutations correctly', () => {
    const mutations = savvycalConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'events.create',
        'events.update',
        'events.cancel',
        'links.create',
        'links.update',
        'links.delete',
        'links.duplicate',
        'links.toggle',
        'workflows.create',
      ].sort(),
    )
  })

  it('classifies reads correctly', () => {
    const reads = savvycalConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('user.current')
    expect(reads).toContain('events.list')
    expect(reads).toContain('events.get')
    expect(reads).toContain('events.findByEmail')
    expect(reads).toContain('links.list')
    expect(reads).toContain('links.get')
    expect(reads).toContain('links.slots')
    expect(reads).toContain('workflows.list')
    expect(reads).toContain('workflows.rules')
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['links.create', 'links.update', 'events.update', 'workflows.create']) {
      const cap = savvycalConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('savvycal links.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/scheduling_links with the link body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'link_1', slug: 'intro-call' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await savvycalConnector.executeMutation!({
      source: source(),
      capabilityName: 'links.create',
      args: { name: 'Intro Call', slug: 'intro-call', durations: [30] },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.savvycal.com/v1/scheduling_links')
    expect(requestBody).toMatchObject({ name: 'Intro Call', slug: 'intro-call', durations: [30] })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      savvycalConnector.executeMutation!({
        source: source(),
        capabilityName: 'links.create',
        args: { name: 'X', slug: 'x', durations: [15] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('savvycal links.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/scheduling_links/{linkId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'link_42', name: 'Updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await savvycalConnector.executeMutation!({
      source: source(),
      capabilityName: 'links.update',
      args: { linkId: 'link_42', name: 'Updated' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.savvycal.com/v1/scheduling_links/link_42')
    expect(requestBody).toMatchObject({ name: 'Updated' })
  })
})

describe('savvycal events.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/events/{eventId} with updated fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'evt_1', title: 'Rescheduled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await savvycalConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.update',
      args: { eventId: 'evt_1', title: 'Rescheduled' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.savvycal.com/v1/events/evt_1')
    expect(requestBody).toMatchObject({ title: 'Rescheduled' })
  })
})

describe('savvycal workflows.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/workflows with the workflow body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'wf_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await savvycalConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.create',
      args: {
        name: 'Confirmation Email',
        trigger: 'event_scheduled',
        action: { type: 'email', template: 'confirmation' },
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.savvycal.com/v1/workflows')
    expect(requestBody).toMatchObject({
      name: 'Confirmation Email',
      trigger: 'event_scheduled',
      action: { type: 'email', template: 'confirmation' },
    })
  })
})
