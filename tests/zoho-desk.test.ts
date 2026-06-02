import { afterEach, describe, expect, it, vi } from 'vitest'
import { zohoDeskConnector } from '../src/connectors/adapters/zoho-desk.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zoho_desk_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zoho-desk',
    label: 'Zoho Desk test',
    consistencyModel: 'authoritative',
    scopes: ['Desk.tickets.ALL'],
    metadata: { apiDomain: 'https://desk.zoho.com' },
    credentials: { kind: 'oauth2', accessToken: 'desk_tok_1' },
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

describe('zoho-desk adapter manifest', () => {
  it('classifies itself as the crm category and exposes the zoho-desk kind', () => {
    expect(zohoDeskConnector.manifest.kind).toBe('zoho-desk')
    expect(zohoDeskConnector.manifest.category).toBe('crm')
    expect(zohoDeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zohoDeskConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set + the write-side additions', () => {
    const names = zohoDeskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.list',
        'tickets.search',
        'tickets.get',
        'tickets.create',
        'tickets.update',
        'tickets.close',
        'tickets.assign',
        'tickets.add-comment',
        'tickets.merge',
        'contacts.find',
      ].sort(),
    )
    const reads = zohoDeskConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zohoDeskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['tickets.list', 'tickets.search', 'tickets.get', 'contacts.find'].sort())
    expect(mutations).toEqual(
      ['tickets.create', 'tickets.update', 'tickets.close', 'tickets.assign', 'tickets.add-comment', 'tickets.merge'].sort(),
    )
  })

  it('marks the new write-side capabilities as native-idempotency external effect', () => {
    const byName = new Map(zohoDeskConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of ['tickets.close', 'tickets.assign', 'tickets.add-comment', 'tickets.merge']) {
      const cap = byName.get(name)
      if (!cap || cap.class !== 'mutation') throw new Error(`expected mutation ${name}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('zoho-desk new mutations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('closes a ticket with PATCH + status: Closed', async () => {
    let url: string | undefined
    let method: string | undefined
    let body: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      method = init?.method
      body = init?.body as string | undefined
      return jsonResponse({ id: 'T1', status: 'Closed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.close',
      args: { ticketId: 'T1' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(method).toBe('PATCH')
    expect(url).toContain('https://desk.zoho.com/desk/v1/tickets/T1')
    expect(JSON.parse(body ?? '{}')).toEqual({ status: 'Closed' })
  })

  it('assigns a ticket with PATCH + assigneeId', async () => {
    let url: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        body = init?.body as string | undefined
        return jsonResponse({ id: 'T2', assigneeId: 'U9' })
      }),
    )

    await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.assign',
      args: { ticketId: 'T2', assigneeId: 'U9' },
      idempotencyKey: 'k-1',
    })

    expect(url).toContain('/desk/v1/tickets/T2')
    expect(JSON.parse(body ?? '{}')).toEqual({ assigneeId: 'U9' })
  })

  it('posts a public comment via /comments', async () => {
    let url: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        body = init?.body as string | undefined
        return jsonResponse({ id: 'CMT_1' }, { status: 201 })
      }),
    )

    await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.add-comment',
      args: { ticketId: 'T3', content: 'On it.', isPublic: true, contentType: 'plainText' },
      idempotencyKey: 'k-1',
    })

    expect(url).toContain('/desk/v1/tickets/T3/comments')
    // body: 'args' passes the arg bag through, so ticketId rides along; Zoho
    // ignores duplicate path-already-bound fields in the body.
    expect(JSON.parse(body ?? '{}')).toEqual({
      ticketId: 'T3',
      content: 'On it.',
      isPublic: true,
      contentType: 'plainText',
    })
  })

  it('merges duplicate tickets via /mergeTickets', async () => {
    let url: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        body = init?.body as string | undefined
        return jsonResponse({ id: 'T_PRIMARY' })
      }),
    )

    await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.merge',
      args: { ticketId: 'T_PRIMARY', ids: ['T_DUP_A', 'T_DUP_B'] },
      idempotencyKey: 'k-1',
    })

    expect(url).toContain('/desk/v1/tickets/T_PRIMARY/mergeTickets')
    expect(JSON.parse(body ?? '{}')).toEqual({ ids: ['T_DUP_A', 'T_DUP_B'] })
  })

  it('surfaces CredentialsExpired on 401 for the new mutation set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zohoDeskConnector.executeMutation!({
        source: source(),
        capabilityName: 'tickets.close',
        args: { ticketId: 'T1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
