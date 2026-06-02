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

  it('exposes the documented posts + pages + media + comments + taxonomies + users surface', () => {
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
        'pages.update',
        'pages.delete',
        'media.list',
        'media.upload',
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'categories.create',
        'tags.create',
        'users.list',
      ].sort(),
    )
  })

  it('marks newly added write capabilities as native-idempotency with externalEffect=true', () => {
    const newMutations = new Set([
      'pages.update',
      'pages.delete',
      'comments.create',
      'comments.delete',
      'media.upload',
    ])
    for (const cap of wordpressConnector.manifest.capabilities) {
      if (!newMutations.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
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

  it('updates a page via POST on the page-id path with body: args', async () => {
    const fetchMock = mockFetch({ id: 55, status: 'publish' })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'pages.update',
      input: { site: 'example.wordpress.com', id: 55, title: 'New page title' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/pages/55',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.title).toBe('New page title')
    expect(body).not.toHaveProperty('content')
    expect(body).not.toHaveProperty('status')
  })

  it('deletes a page with the force=true query parameter when requested', async () => {
    const fetchMock = mockFetch({ deleted: true })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'pages.delete',
      input: { site: 'example.wordpress.com', id: 88, force: true },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/pages/88?force=true',
    )
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('creates a comment via POST on the site comments endpoint', async () => {
    const fetchMock = mockFetch({ id: 9001 }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'comments.create',
      input: {
        site: 'example.wordpress.com',
        post: 42,
        content: '<p>nice post</p>',
        author_name: 'Visitor',
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/comments',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      post: 42,
      content: '<p>nice post</p>',
      author_name: 'Visitor',
    })
    expect(body).not.toHaveProperty('parent')
    expect(body).not.toHaveProperty('author_email')
  })

  it('deletes a comment via DELETE with optional force flag', async () => {
    const fetchMock = mockFetch({ deleted: true })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'comments.delete',
      input: { site: 'example.wordpress.com', id: 17, force: true },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/comments/17?force=true',
    )
    expect((init as RequestInit).method).toBe('DELETE')
  })

  it('creates a category via POST on the site categories endpoint', async () => {
    const fetchMock = mockFetch({ id: 51, name: 'Updates' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'categories.create',
      input: { site: 'example.wordpress.com', name: 'Updates' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/categories',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.name).toBe('Updates')
    expect(body).not.toHaveProperty('parent')
    expect(body).not.toHaveProperty('description')
  })

  it('creates a tag via POST on the site tags endpoint', async () => {
    const fetchMock = mockFetch({ id: 7, name: 'launch' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'tags.create',
      input: { site: 'example.wordpress.com', name: 'launch', slug: 'launch' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/tags',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.name).toBe('launch')
    expect(body.slug).toBe('launch')
  })

  it('lists users via GET on the site users endpoint', async () => {
    const fetchMock = mockFetch([{ id: 1, name: 'Drew' }])
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'users.list',
      input: { site: 'example.wordpress.com', per_page: 25 },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/users?per_page=25',
    )
    expect((init as RequestInit).method).toBe('GET')
  })

  it('uploads a media item by sideloading a source_url via /media/new', async () => {
    const fetchMock = mockFetch({ id: 333, source_url: 'https://example.com/img.png' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [wordpressConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'media.upload',
      input: {
        site: 'example.wordpress.com',
        source_url: 'https://example.com/img.png',
        title: 'Hero image',
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe(
      'https://public-api.wordpress.com/wp/v2/sites/example.wordpress.com/media',
    )
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      source_url: 'https://example.com/img.png',
      title: 'Hero image',
    })
    expect(body).not.toHaveProperty('alt_text')
    expect(body).not.toHaveProperty('caption')
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
