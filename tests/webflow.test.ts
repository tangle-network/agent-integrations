import { afterEach, describe, expect, it, vi } from 'vitest'
import { webflowConnector } from '../src/connectors/adapters/webflow'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types'

function webflowSource(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_webflow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'webflow',
    label: 'Webflow test',
    consistencyModel: 'authoritative',
    scopes: ['sites:read', 'cms:read', 'cms:write', 'pages:read', 'forms:read'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'wf_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('webflow adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(webflowConnector.manifest.kind).toBe('webflow')
    expect(webflowConnector.manifest.displayName).toBe('Webflow')
    expect(webflowConnector.manifest.category).toBe('doc')
    expect(webflowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(webflowConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Webflow OAuth endpoints with the four standard fields', () => {
    const auth = webflowConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://webflow.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.webflow.com/oauth/access_token')
    expect(auth.clientIdEnv).toBe('WEBFLOW_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('WEBFLOW_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['sites:read', 'cms:read', 'cms:write', 'pages:read', 'forms:read']),
    )
  })

  it('covers sites, collections, items, pages, and forms', () => {
    const names = webflowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sites.list',
        'sites.get',
        'sites.publish',
        'collections.list',
        'collections.get',
        'collections.create',
        'collections.delete',
        'items.list',
        'items.get',
        'items.create',
        'items.update',
        'items.delete',
        'items.publish',
        'items.unpublish',
        'pages.list',
        'forms.list',
        'forms.submissions',
      ].sort(),
    )
  })

  it('classifies CRUD correctly: reads vs mutations', () => {
    const reads = webflowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = webflowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'collections.get',
        'collections.list',
        'forms.list',
        'forms.submissions',
        'items.get',
        'items.list',
        'pages.list',
        'sites.get',
        'sites.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'collections.create',
        'collections.delete',
        'items.create',
        'items.delete',
        'items.publish',
        'items.unpublish',
        'items.update',
        'sites.publish',
      ].sort(),
    )
  })

  it('uses native-idempotency CAS for every mutation (Webflow Data API has no ETag/If-Match)', () => {
    const mutations = webflowConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('expected mutation')
      expect(m.cas).toBe('native-idempotency')
      expect(m.externalEffect).toBe(true)
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(webflowConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = webflowConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = webflowConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(webflowConnector.executeRead)).toBe(hasReads)
    expect(Boolean(webflowConnector.executeMutation)).toBe(hasMutations)
  })

  it('scopes write capabilities to cms:write only', () => {
    const writes = webflowConnector.manifest.capabilities.filter((c) =>
      c.name.startsWith('items.') && c.class === 'mutation',
    )
    for (const w of writes) {
      expect(w.requiredScopes).toEqual(['cms:write'])
    }
  })
})

describe('webflow items.unpublish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues POST to the unpublish endpoint with the supplied itemIds', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ unpublishedItemIds: ['itm_1', 'itm_2'], errors: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await webflowConnector.executeMutation!({
      source: webflowSource(),
      capabilityName: 'items.unpublish',
      args: { collectionId: 'col_1', itemIds: ['itm_1', 'itm_2'] },
      idempotencyKey: 'k-unpub-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.webflow.com/v2/collections/col_1/items/unpublish')
    const parsed = JSON.parse(requestBody ?? '{}') as Record<string, unknown>
    expect(parsed.itemIds).toEqual(['itm_1', 'itm_2'])
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      webflowConnector.executeMutation!({
        source: webflowSource(),
        capabilityName: 'items.unpublish',
        args: { collectionId: 'col_1', itemIds: ['itm_1'] },
        idempotencyKey: 'k-unpub-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('webflow collections.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the collection definition to the site-scoped collections endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'col_new', displayName: 'Posts' }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await webflowConnector.executeMutation!({
      source: webflowSource(),
      capabilityName: 'collections.create',
      args: { siteId: 'site_1', displayName: 'Posts', singularName: 'Post' },
      idempotencyKey: 'k-cc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.webflow.com/v2/sites/site_1/collections')
    const parsed = JSON.parse(requestBody ?? '{}') as Record<string, unknown>
    expect(parsed.displayName).toBe('Posts')
    expect(parsed.singularName).toBe('Post')
    // optional slug omitted — not in body
    expect(parsed).not.toHaveProperty('slug')
  })
})

describe('webflow collections.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the collection endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await webflowConnector.executeMutation!({
      source: webflowSource(),
      capabilityName: 'collections.delete',
      args: { collectionId: 'col_doomed' },
      idempotencyKey: 'k-cd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.webflow.com/v2/collections/col_doomed')
  })
})

describe('webflow sites.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /sites/{siteId}/publish with the requested publish targets', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ queued: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await webflowConnector.executeMutation!({
      source: webflowSource(),
      capabilityName: 'sites.publish',
      args: { siteId: 'site_1', publishToWebflowSubdomain: true, customDomains: ['dom_1'] },
      idempotencyKey: 'k-sp-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.webflow.com/v2/sites/site_1/publish')
    const parsed = JSON.parse(requestBody ?? '{}') as Record<string, unknown>
    expect(parsed.publishToWebflowSubdomain).toBe(true)
    expect(parsed.customDomains).toEqual(['dom_1'])
  })
})
