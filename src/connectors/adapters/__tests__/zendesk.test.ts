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
