import { afterEach, describe, expect, it, vi } from 'vitest'
import { gorgiasConnector } from '../gorgias.js'
import { createConnectorAdapterProvider } from '../../../adapter-provider.js'
import type { IntegrationConnection } from '../../../index.js'
import type { ResolvedDataSource } from '../../types.js'

const connection: IntegrationConnection = {
  id: 'conn_gorgias_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'gorgias',
  status: 'active',
  grantedScopes: [
    'tickets:read',
    'tickets:write',
    'customers:read',
    'customers:write',
    'messages:write',
  ],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(): ResolvedDataSource {
  return {
    id: 'source_gorgias',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'gorgias',
    label: 'gorgias',
    consistencyModel: 'authoritative',
    scopes: [
      'tickets:read',
      'tickets:write',
      'customers:read',
      'customers:write',
      'messages:write',
    ],
    metadata: { subdomainUrl: 'https://acme.gorgias.com' },
    credentials: { kind: 'oauth2', accessToken: 'token_gorgias' },
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

describe('gorgiasConnector', () => {
  it('exposes the documented OAuth2 manifest with per-subdomain authorize/token URLs and resource scopes', () => {
    expect(gorgiasConnector.manifest.kind).toBe('gorgias')
    expect(gorgiasConnector.manifest.displayName).toBe('Gorgias')
    expect(gorgiasConnector.manifest.category).toBe('crm')
    expect(gorgiasConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = gorgiasConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://{subdomain}.gorgias.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://{subdomain}.gorgias.com/oauth2/token')
    expect(auth.clientIdEnv).toBe('GORGIAS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GORGIAS_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'tickets:read',
        'tickets:write',
        'customers:read',
        'customers:write',
        'messages:read',
        'messages:write',
      ]),
    )
  })

  it('declares the support-desk action surface with classes, CAS, and scope guards', () => {
    const caps = gorgiasConnector.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'customers.create',
      'customers.search',
      'messages.create',
      'tickets.close',
      'tickets.create',
      'tickets.get',
      'tickets.search',
      'tickets.update',
    ])

    expect(byName['tickets.search'].class).toBe('read')
    expect(byName['tickets.search'].requiredScopes).toEqual(['tickets:read'])

    const create = byName['tickets.create']
    expect(create.class).toBe('mutation')
    if (create.class !== 'mutation') throw new Error('expected mutation')
    expect(create.cas).toBe('native-idempotency')
    expect(create.requiredScopes).toEqual(['tickets:write'])

    const update = byName['tickets.update']
    if (update.class !== 'mutation') throw new Error('expected mutation')
    expect(update.cas).toBe('optimistic-read-verify')
    expect(update.requiredScopes).toEqual(['tickets:write'])

    const messageCreate = byName['messages.create']
    if (messageCreate.class !== 'mutation') throw new Error('expected mutation')
    expect(messageCreate.cas).toBe('native-idempotency')
    expect(messageCreate.requiredScopes).toEqual(['messages:write'])
  })

  it('executes tickets.search against the tenant subdomain with bearer auth and interpolated query', async () => {
    const fetchMock = mockFetch({ data: [{ id: 42, subject: 'Order missing' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [gorgiasConnector],
      resolveDataSource: () => sourceFor(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.search',
      input: { status: 'open', limit: 25 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ data: [{ id: 42, subject: 'Order missing' }] })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://acme.gorgias.com/api/tickets')
    expect(String(url)).toContain('status=open')
    expect(String(url)).toContain('limit=25')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token_gorgias' })
  })

  it('serializes ticket payloads directly as the Gorgias create-ticket body', async () => {
    const fetchMock = mockFetch({ id: 99 }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [gorgiasConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tickets.create',
      input: {
        channel: 'email',
        via: 'api',
        subject: 'Refund please',
        customer: { email: 'shopper@example.com' },
        messages: [
          {
            channel: 'email',
            via: 'api',
            from_agent: false,
            sender: { email: 'shopper@example.com' },
            body_text: 'I want a refund.',
          },
        ],
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://acme.gorgias.com/api/tickets')
    const body = JSON.parse(String(init.body))
    expect(body.channel).toBe('email')
    expect(body.subject).toBe('Refund please')
    expect(body.customer).toEqual({ email: 'shopper@example.com' })
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('routes messages.create to the nested ticket-messages collection', async () => {
    const fetchMock = mockFetch({ id: 555 }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [gorgiasConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'messages.create',
      input: {
        ticketId: 42,
        channel: 'email',
        via: 'api',
        sender: { email: 'support@acme.com' },
        body_text: 'On its way.',
        public: true,
      },
    })

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://acme.gorgias.com/api/tickets/42/messages')
  })
})
