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
    scopes: ['Desk.tickets.ALL', 'Desk.contacts.READ', 'Desk.search.READ', 'Desk.basic.READ'],
    metadata: { deskApiDomain: 'https://desk.zoho.com' },
    credentials: { kind: 'oauth2', accessToken: 'desk_tok_1' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

describe('zoho-desk adapter manifest', () => {
  it('uses the shared Zoho OAuth app and exact comma-delimited Desk scopes', () => {
    expect(zohoDeskConnector.manifest.kind).toBe('zoho-desk')
    expect(zohoDeskConnector.manifest.category).toBe('crm')
    expect(zohoDeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(zohoDeskConnector.manifest.auth).toMatchObject({
      kind: 'oauth2',
      clientIdEnv: 'ZOHO_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ZOHO_OAUTH_CLIENT_SECRET',
      scopes: ['Desk.tickets.ALL', 'Desk.contacts.READ', 'Desk.search.READ', 'Desk.basic.READ'],
      scopeSeparator: ',',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    })
  })

  it('exposes organization discovery and the documented ticket and contact operations', () => {
    const names = zohoDeskConnector.manifest.capabilities.map((capability) => capability.name).sort()
    expect(names).toEqual([
      'contacts.find',
      'organizations.list',
      'tickets.add-comment',
      'tickets.assign',
      'tickets.close',
      'tickets.create',
      'tickets.get',
      'tickets.list',
      'tickets.merge',
      'tickets.update',
    ])

    const mutations = zohoDeskConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(6)
    for (const capability of mutations) expect(capability.externalEffect, capability.name).toBe(true)
  })
})

describe('zoho-desk organization isolation and execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('discovers organizations without requiring an organization header', async () => {
    let request: { url?: string; orgId?: string | null } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        orgId: new Headers(init?.headers).get('orgId'),
      }
      return jsonResponse({ data: [{ id: 'org_1' }] })
    }))

    await zohoDeskConnector.executeRead!({
      source: source(),
      capabilityName: 'organizations.list',
      args: {},
      idempotencyKey: 'read-1',
    })

    expect(request).toEqual({
      url: 'https://desk.zoho.com/api/v1/organizations',
      orgId: null,
    })
  })

  it('sends the required orgId header on ticket reads and keeps it out of the query', async () => {
    let request: { url?: string; orgId?: string | null; authorization?: string | null } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      request = {
        url: String(input),
        orgId: headers.get('orgId'),
        authorization: headers.get('authorization'),
      }
      return jsonResponse({ data: [] })
    }))

    await zohoDeskConnector.executeRead!({
      source: source({ metadata: { deskApiDomain: 'https://desk.zoho.eu' } }),
      capabilityName: 'tickets.list',
      args: { orgId: 'org_123', status: 'Open', limit: 50 },
      idempotencyKey: 'read-2',
    })

    expect(request).toEqual({
      url: 'https://desk.zoho.eu/api/v1/tickets?limit=50&status=Open',
      orgId: 'org_123',
      authorization: 'Zoho-oauthtoken desk_tok_1',
    })
  })

  it('closes a ticket with the organization header and provider-native body', async () => {
    let request: { url?: string; orgId?: string | null; method?: string; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        orgId: new Headers(init?.headers).get('orgId'),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      }
      return jsonResponse({ id: 'ticket_1', status: 'Closed' })
    }))

    const result = await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.close',
      args: { orgId: 'org_123', ticketId: 'ticket_1' },
      idempotencyKey: 'write-1',
    })

    expect(request).toEqual({
      url: 'https://desk.zoho.com/api/v1/tickets/ticket_1',
      orgId: 'org_123',
      method: 'PATCH',
      body: { status: 'Closed' },
    })
    expect(result.status).toBe('committed')
  })

  it('adds a comment without leaking path or organization arguments into the body', async () => {
    let request: { url?: string; orgId?: string | null; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        orgId: new Headers(init?.headers).get('orgId'),
        body: JSON.parse(String(init?.body)),
      }
      return jsonResponse({ id: 'comment_1' }, { status: 201 })
    }))

    await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.add-comment',
      args: {
        orgId: 'org_123',
        ticketId: 'ticket_1',
        content: 'On it.',
        isPublic: true,
        contentType: 'plainText',
      },
      idempotencyKey: 'write-2',
    })

    expect(request).toEqual({
      url: 'https://desk.zoho.com/api/v1/tickets/ticket_1/comments',
      orgId: 'org_123',
      body: { content: 'On it.', isPublic: true, contentType: 'plainText' },
    })
  })

  it('merges duplicate tickets with an array body and the organization header', async () => {
    let body: unknown
    let orgId: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      orgId = new Headers(init?.headers).get('orgId')
      return jsonResponse({ id: 'ticket_primary' })
    }))

    await zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.merge',
      args: {
        orgId: 'org_123',
        ticketId: 'ticket_primary',
        ids: ['ticket_duplicate_1', 'ticket_duplicate_2'],
      },
      idempotencyKey: 'write-3',
    })

    expect(orgId).toBe('org_123')
    expect(body).toEqual({ ids: ['ticket_duplicate_1', 'ticket_duplicate_2'] })
  })

  it('requires orgId before sending an organization-scoped request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(zohoDeskConnector.executeRead!({
      source: source(),
      capabilityName: 'tickets.get',
      args: { ticketId: 'ticket_1' },
      idempotencyKey: 'read-3',
    })).rejects.toThrow('missing required argument: orgId')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects lookalike regional hosts before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(zohoDeskConnector.executeRead!({
      source: source({ metadata: { deskApiDomain: 'https://desk.zoho.eu.attacker.test' } }),
      capabilityName: 'organizations.list',
      args: {},
      idempotencyKey: 'read-4',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces expired credentials on organization-scoped mutations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    await expect(zohoDeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.assign',
      args: { orgId: 'org_123', ticketId: 'ticket_1', assigneeId: 'agent_1' },
      idempotencyKey: 'write-4',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
