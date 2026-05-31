import { afterEach, describe, expect, it, vi } from 'vitest'
import { zendeskConnector } from '../zendesk.js'
import { createConnectorAdapterProvider } from '../../../adapter-provider.js'
import type { IntegrationConnection } from '../../../index.js'
import type { ResolvedDataSource } from '../../types.js'

const connection: IntegrationConnection = {
  id: 'conn_zendesk_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'zendesk',
  status: 'active',
  grantedScopes: ['read', 'write'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(): ResolvedDataSource {
  return {
    id: 'source_zendesk',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'zendesk',
    label: 'zendesk',
    consistencyModel: 'authoritative',
    scopes: ['read', 'write'],
    metadata: { subdomainUrl: 'https://acme.zendesk.com' },
    credentials: { kind: 'oauth2', accessToken: 'token_zendesk' },
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

describe('zendeskConnector', () => {
  it('exposes the documented OAuth2 manifest and per-subdomain authorize/token URLs', () => {
    expect(zendeskConnector.manifest.kind).toBe('zendesk')
    expect(zendeskConnector.manifest.displayName).toBe('Zendesk')
    expect(zendeskConnector.manifest.category).toBe('crm')
    expect(zendeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = zendeskConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://{subdomain}.zendesk.com/oauth/authorizations/new')
    expect(auth.tokenUrl).toBe('https://{subdomain}.zendesk.com/oauth/tokens')
    expect(auth.scopes).toEqual(['read', 'write'])
    expect(auth.clientIdEnv).toBe('ZENDESK_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ZENDESK_OAUTH_CLIENT_SECRET')
  })

  it('declares the support-desk action surface with classes, CAS, and scope guards', () => {
    const caps = zendeskConnector.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'tickets.create',
      'tickets.get',
      'tickets.search',
      'tickets.update',
      'users.create',
      'users.search',
    ])

    expect(byName['tickets.search'].class).toBe('read')
    expect(byName['tickets.search'].requiredScopes).toEqual(['read'])

    const create = byName['tickets.create']
    expect(create.class).toBe('mutation')
    if (create.class !== 'mutation') throw new Error('expected mutation')
    expect(create.cas).toBe('native-idempotency')
    expect(create.requiredScopes).toEqual(['write'])

    const update = byName['tickets.update']
    if (update.class !== 'mutation') throw new Error('expected mutation')
    expect(update.cas).toBe('optimistic-read-verify')
  })

  it('executes tickets.search against /api/v2/search.json with bearer auth and interpolated query', async () => {
    const fetchMock = mockFetch({ results: [{ id: 7, subject: 'Login fails' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [zendeskConnector],
      resolveDataSource: () => sourceFor(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.search',
      input: { query: 'status:open type:ticket', per_page: 25 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ results: [{ id: 7, subject: 'Login fails' }] })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://acme.zendesk.com/api/v2/search.json')
    expect(String(url)).toContain('query=status%3Aopen+type%3Aticket')
    expect(String(url)).toContain('per_page=25')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token_zendesk' })
  })

  it('wraps ticket payloads under the Zendesk { ticket } envelope on tickets.create', async () => {
    const fetchMock = mockFetch({ ticket: { id: 123 } }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [zendeskConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.create',
      input: { ticket: { subject: 'Help', comment: { body: 'Reset password' } } },
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ticket: { subject: 'Help', comment: { body: 'Reset password' } },
    })
  })
})
