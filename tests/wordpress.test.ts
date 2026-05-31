import { afterEach, describe, expect, it, vi } from 'vitest'
import { wordpressConnector } from '../src/connectors/adapters/wordpress.js'
import { validateConnectorManifest } from '../src/connectors/types.js'
import {
  createConnectorAdapterProvider,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index.js'

const connection: IntegrationConnection = {
  id: 'conn_wp',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'wordpress',
  status: 'active',
  grantedScopes: ['posts', 'media', 'comments'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('wordpress adapter manifest', () => {
  it('identifies as wordpress in the doc category with an authoritative consistency model', () => {
    expect(wordpressConnector.manifest.kind).toBe('wordpress')
    expect(wordpressConnector.manifest.displayName).toBe('WordPress')
    expect(wordpressConnector.manifest.category).toBe('doc')
    expect(wordpressConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against public-api.wordpress.com with four config fields', () => {
    const auth = wordpressConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://public-api.wordpress.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://public-api.wordpress.com/oauth2/token')
    expect(auth.clientIdEnv).toBe('WORDPRESS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('WORDPRESS_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(expect.arrayContaining(['posts', 'media', 'comments']))
  })

  it('exposes the documented posts + pages + media + comments surface', () => {
    const names = wordpressConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'posts.list',
        'posts.get',
        'posts.create',
        'posts.update',
        'posts.delete',
        'pages.list',
        'pages.create',
        'media.list',
        'comments.list',
        'comments.update',
      ].sort(),
    )
  })

  it('marks every mutation with a CAS strategy and externalEffect true', () => {
    for (const cap of wordpressConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(['native-idempotency', 'etag-if-match', 'optimistic-read-verify']).toContain(cap.cas)
        expect(cap.externalEffect).toBe(true)
      }
    }
  })

  it('requires only site + title for posts.create — every other field is optional', () => {
    const create = wordpressConnector.manifest.capabilities.find((c) => c.name === 'posts.create')
    expect(create).toBeDefined()
    const params = create!.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(params.required).toEqual(['site', 'title'])
    expect(Object.keys(params.properties ?? {})).toEqual(
      expect.arrayContaining([
        'site',
        'title',
        'content',
        'excerpt',
        'slug',
        'status',
        'categories',
        'tags',
        'featured_media',
      ]),
    )
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(wordpressConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = wordpressConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = wordpressConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(wordpressConnector.executeRead)).toBe(hasReads)
    expect(Boolean(wordpressConnector.executeMutation)).toBe(hasMutations)
  })
})

describe('wordpress adapter execution', () => {
  it('lists posts via GET on the site-scoped path with bearer auth', async () => {
    const fetchMock = mockFetch([{ id: 1, title: { rendered: 'Hello' } }])
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'posts.list',
      input: { site: 'example.wordpress.com', per_page: 10, status: 'publish' },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/posts?status=publish&per_page=10',
    )
    expect((init as RequestInit).method).toBe('GET')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer wp_access_token')
  })

  it('creates a post with only required fields — optional fields never appear as literal placeholders', async () => {
    const fetchMock = mockFetch({ id: 42, status: 'draft' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'posts.create',
      input: {
        site: '12345',
        title: 'Wire the WordPress adapter',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ id: 42, status: 'draft' })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://public-api.wordpress.com/wp/v2/sites/12345/posts')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.title).toBe('Wire the WordPress adapter')
    expect(body).not.toHaveProperty('content')
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('categories')
    // No literal placeholders leaked through.
    for (const value of Object.values(body)) {
      if (typeof value === 'string') expect(value).not.toMatch(/^\{[a-z_]+\}$/i)
    }
  })

  it('passes optional post fields through verbatim when supplied', async () => {
    const fetchMock = mockFetch({ id: 43 }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'posts.create',
      input: {
        site: 'example.wordpress.com',
        title: 'Launch day',
        content: '<p>Hello world.</p>',
        status: 'publish',
        categories: [12, 34],
        tags: [99],
        featured_media: 777,
      },
    })

    const [, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      title: 'Launch day',
      content: '<p>Hello world.</p>',
      status: 'publish',
      categories: [12, 34],
      tags: [99],
      featured_media: 777,
    })
  })

  it('deletes a post with the force=true query parameter when requested', async () => {
    const fetchMock = mockFetch({ deleted: true, previous: { id: 99 } })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'posts.delete',
      input: { site: 'example.wordpress.com', id: 99, force: true },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/posts/99?force=true',
    )
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('moderates a comment via POST with a status-only body', async () => {
    const fetchMock = mockFetch({ id: 7, status: 'approve' })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'comments.update',
      input: { site: 'example.wordpress.com', id: 7, status: 'approve' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/comments/7',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.status).toBe('approve')
    expect(body).not.toHaveProperty('content')
  })
})

function sourceFor(conn: IntegrationConnection): ResolvedDataSource {
  return {
    id: `source_${conn.connectorId}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: conn.connectorId,
    label: conn.connectorId,
    consistencyModel: 'authoritative',
    scopes: ['posts', 'media', 'comments'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'wp_access_token',
    },
    status: 'active',
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(
    async (_input: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...init.headers },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
