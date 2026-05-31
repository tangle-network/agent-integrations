import { afterEach, describe, expect, it, vi } from 'vitest'
import { intercomConnector } from '../intercom.js'
import { createConnectorAdapterProvider } from '../../../adapter-provider.js'
import type { IntegrationConnection } from '../../../index.js'
import type { ResolvedDataSource } from '../../types.js'

const connection: IntegrationConnection = {
  id: 'conn_intercom_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'intercom',
  status: 'active',
  grantedScopes: ['intercom.read', 'intercom.write'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(): ResolvedDataSource {
  return {
    id: 'source_intercom',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'intercom',
    label: 'intercom',
    consistencyModel: 'authoritative',
    scopes: ['intercom.read', 'intercom.write'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'token_intercom' },
    status: 'active',
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fn = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('intercomConnector', () => {
  it('exposes the documented OAuth2 manifest with Intercom authorize/token URLs', () => {
    expect(intercomConnector.manifest.kind).toBe('intercom')
    expect(intercomConnector.manifest.displayName).toBe('Intercom')
    expect(intercomConnector.manifest.category).toBe('crm')
    expect(intercomConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = intercomConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://app.intercom.com/oauth')
    expect(auth.tokenUrl).toBe('https://api.intercom.io/auth/eagle/token')
    expect(auth.clientIdEnv).toBe('INTERCOM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('INTERCOM_OAUTH_CLIENT_SECRET')
    // Intercom apps declare permissions at app-config time, not per-authorize.
    expect(auth.scopes).toEqual([])
  })

  it('declares the support action surface with read/mutation classes, CAS, and scope guards', () => {
    const caps = intercomConnector.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'customers.read',
      'tickets.reply',
      'tickets.search',
      'tickets.update',
    ])

    expect(byName['tickets.search'].class).toBe('read')
    expect(byName['tickets.search'].requiredScopes).toEqual(['intercom.read'])
    expect(byName['customers.read'].class).toBe('read')
    expect(byName['customers.read'].requiredScopes).toEqual(['intercom.read'])

    const reply = byName['tickets.reply']
    expect(reply.class).toBe('mutation')
    if (reply.class !== 'mutation') throw new Error('expected mutation')
    expect(reply.cas).toBe('native-idempotency')
    expect(reply.requiredScopes).toEqual(['intercom.write'])

    const update = byName['tickets.update']
    if (update.class !== 'mutation') throw new Error('expected mutation')
    expect(update.cas).toBe('optimistic-read-verify')
    expect(update.requiredScopes).toEqual(['intercom.write'])
  })

  it('executes tickets.search against POST /conversations/search with bearer auth, Intercom-Version pin, and the body payload', async () => {
    const fetchMock = mockFetch({ conversations: [{ id: 'c_1' }], total_count: 1 })
    const provider = createConnectorAdapterProvider({
      adapters: [intercomConnector],
      resolveDataSource: () => sourceFor(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.search',
      input: {
        body: {
          query: { field: 'state', operator: '=', value: 'open' },
          pagination: { per_page: 20 },
        },
      },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ conversations: [{ id: 'c_1' }], total_count: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.intercom.io/conversations/search')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer token_intercom',
      'intercom-version': '2.11',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      query: { field: 'state', operator: '=', value: 'open' },
      pagination: { per_page: 20 },
    })
  })

  it('posts the reply payload to /conversations/{id}/reply without leaking conversationId into the body', async () => {
    const fetchMock = mockFetch({ id: 'c_42', type: 'conversation' }, { status: 200 })
    const provider = createConnectorAdapterProvider({
      adapters: [intercomConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.reply',
      input: {
        conversationId: 'c_42',
        body: {
          message_type: 'comment',
          type: 'admin',
          admin_id: 'admin_7',
          body: 'Thanks — we are looking into it now.',
        },
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.intercom.io/conversations/c_42/reply')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      message_type: 'comment',
      type: 'admin',
      admin_id: 'admin_7',
      body: 'Thanks — we are looking into it now.',
    })
  })

  it('puts the conversation update payload at /conversations/{id} with the right verb', async () => {
    const fetchMock = mockFetch({ id: 'c_42', state: 'closed' })
    const provider = createConnectorAdapterProvider({
      adapters: [intercomConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.update',
      input: {
        conversationId: 'c_42',
        body: { state: 'closed', read: true, custom_attributes: { priority: 'high' } },
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.intercom.io/conversations/c_42')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({
      state: 'closed',
      read: true,
      custom_attributes: { priority: 'high' },
    })
  })
})
