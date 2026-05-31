import { afterEach, describe, expect, it, vi } from 'vitest'
import { helpscoutConnector } from '../helpscout.js'
import { createConnectorAdapterProvider } from '../../../adapter-provider.js'
import type { IntegrationConnection } from '../../../index.js'
import type { ResolvedDataSource } from '../../types.js'

const connection: IntegrationConnection = {
  id: 'conn_helpscout_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'helpscout',
  status: 'active',
  grantedScopes: ['tickets.search.read', 'tickets.reply.write', 'customers.read'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(): ResolvedDataSource {
  return {
    id: 'source_helpscout',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'helpscout',
    label: 'helpscout',
    consistencyModel: 'authoritative',
    scopes: ['tickets.search.read', 'tickets.reply.write', 'customers.read'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'token_helpscout' },
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

describe('helpscoutConnector', () => {
  it('exposes the documented Mailbox v2 OAuth2 manifest', () => {
    expect(helpscoutConnector.manifest.kind).toBe('helpscout')
    expect(helpscoutConnector.manifest.displayName).toBe('Help Scout')
    expect(helpscoutConnector.manifest.category).toBe('crm')
    expect(helpscoutConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = helpscoutConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://secure.helpscout.net/authentication/authorizeClientApplication')
    expect(auth.tokenUrl).toBe('https://api.helpscout.net/v2/oauth2/token')
    expect(auth.scopes).toEqual(['tickets.search.read', 'tickets.reply.write', 'customers.read'])
    expect(auth.clientIdEnv).toBe('HELPSCOUT_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('HELPSCOUT_OAUTH_CLIENT_SECRET')
  })

  it('declares the support-desk action surface with classes, CAS, and scope guards', () => {
    const caps = helpscoutConnector.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'customers.read',
      'tickets.read',
      'tickets.reply',
      'tickets.search',
      'tickets.update',
    ])

    expect(byName['tickets.search'].class).toBe('read')
    expect(byName['tickets.search'].requiredScopes).toEqual(['tickets.search.read'])

    const reply = byName['tickets.reply']
    expect(reply.class).toBe('mutation')
    if (reply.class !== 'mutation') throw new Error('expected mutation')
    expect(reply.cas).toBe('native-idempotency')
    expect(reply.requiredScopes).toEqual(['tickets.reply.write'])

    const update = byName['tickets.update']
    if (update.class !== 'mutation') throw new Error('expected mutation')
    expect(update.cas).toBe('optimistic-read-verify')
  })

  it('executes tickets.search against /v2/conversations with bearer auth and interpolated query', async () => {
    const fetchMock = mockFetch({ _embedded: { conversations: [{ id: 7, subject: 'Login fails' }] } })
    const provider = createConnectorAdapterProvider({
      adapters: [helpscoutConnector],
      resolveDataSource: () => sourceFor(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.search',
      input: { query: 'status:active subject:"login"', size: 25 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ _embedded: { conversations: [{ id: 7, subject: 'Login fails' }] } })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://api.helpscout.net/v2/conversations')
    expect(String(url)).toContain('query=status%3Aactive')
    expect(String(url)).toContain('size=25')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token_helpscout' })
  })

  it('sends the reply body in the documented Help Scout reply payload shape', async () => {
    const fetchMock = mockFetch({}, { status: 201, headers: { 'resource-id': '999' } })
    const provider = createConnectorAdapterProvider({
      adapters: [helpscoutConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.reply',
      input: {
        conversationId: '42',
        text: 'Hi there — we are looking into this.',
        customer: { id: 17 },
        user: 5,
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.helpscout.net/v2/conversations/42/reply')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.text).toBe('Hi there — we are looking into this.')
    expect(body.customer).toEqual({ id: 17 })
    expect(body.user).toBe(5)
  })
})
