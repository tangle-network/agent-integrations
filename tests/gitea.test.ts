import { afterEach, describe, expect, it, vi } from 'vitest'
import { giteaConnector } from '../src/connectors/adapters/gitea.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gitea_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gitea',
    label: 'Gitea test',
    consistencyModel: 'authoritative',
    scopes: [
      'read:user',
      'write:user',
      'read:issue',
      'write:issue',
      'read:repository',
      'write:repository',
    ],
    metadata: { instanceUrl: 'https://git.tangle.tools' },
    credentials: { kind: 'oauth2', accessToken: 'gitea_access_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('gitea adapter manifest', () => {
  it('classifies itself as the other category and exposes the gitea kind', () => {
    expect(giteaConnector.manifest.kind).toBe('gitea')
    expect(giteaConnector.manifest.category).toBe('other')
    expect(giteaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses instance-relative OAuth endpoints and current granular scopes', () => {
    const auth = giteaConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('gitea auth must be oauth2')
    expect(auth.authorizationUrl).toBe('{instanceUrl}/login/oauth/authorize')
    expect(auth.tokenUrl).toBe('{instanceUrl}/login/oauth/access_token')
    expect(auth.scopes).toEqual([
      'read:user',
      'write:user',
      'read:issue',
      'write:issue',
      'read:repository',
      'write:repository',
    ])
    expect(auth.scopes).not.toEqual(expect.arrayContaining(['repo', 'admin']))
    expect(auth.pkce).toBe('supported')
    expect(auth.urlTemplateMetadata).toEqual({
      instanceUrl: {
        kind: 'base-url',
        requirePublicHttps: true,
      },
    })
  })

  it.each([
    'http://gitea.example.com',
    'https://localhost',
    'https://10.0.0.1',
    'https://gitea.internal',
    'https://user:secret@gitea.example.com',
  ])('rejects hostile instance root %s before sending credentials', async (instanceUrl) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(giteaConnector.executeRead!({
      source: source({ metadata: { instanceUrl } }),
      capabilityName: 'repos.list',
      args: { owner: 'drew' },
      idempotencyKey: 'host-policy',
    })).rejects.toThrow('connection base URL must be a public HTTPS endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('covers the activepieces action set plus repo + pull-request lifecycle writes', () => {
    const names = giteaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'repos.list',
        'repos.create',
        'repos.delete',
        'issues.create',
        'issues.update',
        'comments.create',
        'pull-requests.list',
        'pull-requests.create',
        'pull-requests.merge',
        'branches.list',
      ].sort(),
    )
    const reads = giteaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = giteaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['repos.list', 'pull-requests.list', 'branches.list'].sort())
    expect(mutations).toEqual(
      [
        'repos.create',
        'repos.delete',
        'issues.create',
        'issues.update',
        'comments.create',
        'pull-requests.create',
        'pull-requests.merge',
      ].sort(),
    )
  })

  it('marks the new lifecycle mutations as native-idempotent external effect', () => {
    const newMutations = ['repos.create', 'repos.delete', 'pull-requests.merge']
    for (const name of newMutations) {
      const cap = giteaConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} should be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('gitea repos.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/user/repos with the repo payload in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      const headers = (init?.headers ?? {}) as Record<string, string>
      authHeader = headers.authorization
      return jsonResponse({ id: 42, name: 'autonomy', full_name: 'drew/autonomy' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await giteaConnector.executeMutation!({
      source: source(),
      capabilityName: 'repos.create',
      args: { name: 'autonomy', private: true, auto_init: true },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://git.tangle.tools/api/v1/user/repos')
    expect(authHeader).toBe('Bearer gitea_access_token')
    expect(requestBody).toMatchObject({ name: 'autonomy', private: true, auto_init: true })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      giteaConnector.executeMutation!({
        source: source(),
        capabilityName: 'repos.create',
        args: { name: 'autonomy' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('gitea repos.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/repos/{owner}/{repo}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await giteaConnector.executeMutation!({
      source: source(),
      capabilityName: 'repos.delete',
      args: { owner: 'drew', repo: 'autonomy' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://git.tangle.tools/api/v1/repos/drew/autonomy')
  })
})

describe('gitea pull-requests.merge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/repos/{owner}/{repo}/pulls/{index}/merge with the Do verb', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ merged: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await giteaConnector.executeMutation!({
      source: source(),
      capabilityName: 'pull-requests.merge',
      args: { owner: 'drew', repo: 'autonomy', index: 7, Do: 'squash' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe(
      'https://git.tangle.tools/api/v1/repos/drew/autonomy/pulls/7/merge',
    )
    expect(requestBody).toMatchObject({ Do: 'squash' })
  })
})
