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
