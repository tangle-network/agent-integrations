import { afterEach, describe, expect, it, vi } from 'vitest'
import { frontConnector } from '../front.js'
import { createConnectorAdapterProvider } from '../../../adapter-provider.js'
import type { IntegrationConnection } from '../../../index.js'
import type { ResolvedDataSource } from '../../types.js'

const connection: IntegrationConnection = {
  id: 'conn_front_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'front',
  status: 'active',
  grantedScopes: ['shared_resources'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(): ResolvedDataSource {
  return {
    id: 'source_front',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'front',
    label: 'front',
    consistencyModel: 'authoritative',
    scopes: ['shared_resources'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'token_front' },
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

describe('frontConnector', () => {
  it('exposes the documented Front OAuth2 manifest', () => {
    expect(frontConnector.manifest.kind).toBe('front')
    expect(frontConnector.manifest.displayName).toBe('Front')
    expect(frontConnector.manifest.category).toBe('comms')
    expect(frontConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = frontConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://app.frontapp.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://app.frontapp.com/oauth/token')
    expect(auth.scopes).toEqual(['shared_resources', 'private_resources'])
    expect(auth.clientIdEnv).toBe('FRONT_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FRONT_OAUTH_CLIENT_SECRET')
  })

  it('declares the shared-inbox action surface with classes, CAS, and scope guards', () => {
    const caps = frontConnector.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'contacts.create',
      'contacts.search',
      'contacts.update',
      'conversations.add_comment',
      'conversations.get',
      'conversations.list_messages',
      'conversations.reply',
      'conversations.search',
      'conversations.update',
    ])

    expect(byName['conversations.search'].class).toBe('read')
    expect(byName['conversations.search'].requiredScopes).toEqual(['shared_resources'])

    const reply = byName['conversations.reply']
    expect(reply.class).toBe('mutation')
    if (reply.class !== 'mutation') throw new Error('expected mutation')
    expect(reply.cas).toBe('native-idempotency')
    expect(reply.requiredScopes).toEqual(['shared_resources'])

    const update = byName['conversations.update']
    if (update.class !== 'mutation') throw new Error('expected mutation')
    expect(update.cas).toBe('etag-if-match')
  })

  it('executes conversations.search against /conversations/search/{q} with bearer auth and path interpolation', async () => {
    const fetchMock = mockFetch({ _results: [{ id: 'cnv_1', subject: 'Refund?' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [frontConnector],
      resolveDataSource: () => sourceFor(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'conversations.search',
      input: { q: 'is:open tag:billing', limit: 25 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ _results: [{ id: 'cnv_1', subject: 'Refund?' }] })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://api2.frontapp.com/conversations/search/')
    expect(String(url)).toContain('is%3Aopen%20tag%3Abilling')
    expect(String(url)).toContain('limit=25')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token_front' })
  })

  it('sends conversations.reply with body, author, and recipients in the Front payload shape', async () => {
    const fetchMock = mockFetch({ id: 'msg_1' }, { status: 202 })
    const provider = createConnectorAdapterProvider({
      adapters: [frontConnector],
      resolveDataSource: () => sourceFor(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'conversations.reply',
      input: {
        conversation_id: 'cnv_42',
        author_id: 'tea_99',
        body: '<p>Refund issued.</p>',
        to: ['customer@example.com'],
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('/conversations/cnv_42/messages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      author_id: 'tea_99',
      body: '<p>Refund issued.</p>',
      to: ['customer@example.com'],
    })
  })
})
