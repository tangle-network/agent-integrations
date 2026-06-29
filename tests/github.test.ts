import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubConnector, type ResolvedDataSource } from '../src/connectors/index'
import { validateConnectorManifest } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_github_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'github',
    label: 'Drew GitHub',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'ghp_test' },
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

describe('github adapter', () => {
  const adapter = githubConnector

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest passes the shared validator', () => {
    const result = validateConnectorManifest(adapter.manifest)
    expect(result.ok).toBe(true)
  })

  it('manifest exposes the full capability set (reads + mutations)', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        // reads
        'activity.checkStarred',
        'issues.search',
        'orgs.checkMembership',
        'repos.getReadme',
        'repos.listCommits',
        'repositories.get',
        'search.code',
        'users.checkFollowing',
        'users.getAuthenticated',
        // mutations
        'issues.create',
        'issues.createComment',
        'issues.update',
        'pulls.create',
        'pulls.merge',
        'pulls.reviews.create',
      ].sort(),
    )
    const mutations = adapter.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const m of mutations) {
      expect((m as { cas: string }).cas).toBeDefined()
      expect((m as { externalEffect: boolean }).externalEffect).toBe(true)
    }
  })

  // ---------- read capabilities (quest verification) ----------

  it('users.getAuthenticated GETs /user and returns the token owner', async () => {
    let calledUrl = ''
    let calledMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      return jsonResponse({ login: 'octocat', id: 583231 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.getAuthenticated',
      args: {},
      idempotencyKey: 'k',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toMatch(/\/user$/)
    expect((result.data as { login: string }).login).toBe('octocat')
    expect(result.fetchedAt).toBeTypeOf('number')
  })

  it('activity.checkStarred maps 204 to { exists: true } without throwing', async () => {
    let calledUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'activity.checkStarred',
      args: { owner: 'octo', repo: 'hello' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/user/starred/octo/hello')
    expect(result.data).toEqual({ exists: true })
  })

  it('activity.checkStarred maps 404 to { exists: false } without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    )
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'activity.checkStarred',
      args: { owner: 'octo', repo: 'hello' },
      idempotencyKey: 'k',
    })
    expect(result.data).toEqual({ exists: false })
  })

  it('activity.checkStarred still fails loud on a non-204/404 error (500)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'activity.checkStarred',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('users.checkFollowing probes /user/following/{target} with 204/404 semantics', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return new Response(null, { status: 204 })
      }),
    )
    const following = await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.checkFollowing',
      args: { target: 'defunkt' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/user/following/defunkt')
    expect(following.data).toEqual({ exists: true })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    )
    const notFollowing = await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.checkFollowing',
      args: { target: 'defunkt' },
      idempotencyKey: 'k',
    })
    expect(notFollowing.data).toEqual({ exists: false })
  })

  it('users.checkFollowing rejects a missing required target arg', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'users.checkFollowing',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: target/)
  })

  it('repos.listCommits templates the author + per_page query params', async () => {
    let calledUrl = ''
    let calledMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input)
        calledMethod = init?.method ?? ''
        return jsonResponse([{ sha: 'abc', commit: { message: 'init' } }])
      }),
    )
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.listCommits',
      args: { owner: 'octo', repo: 'hello', author: 'octocat', per_page: 5 },
      idempotencyKey: 'k',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toContain('/repos/octo/hello/commits')
    expect(calledUrl).toContain('author=octocat')
    expect(calledUrl).toContain('per_page=5')
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('repos.listCommits omits the author query param when not provided', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([])
      }),
    )
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.listCommits',
      args: { owner: 'octo', repo: 'hello' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/octo/hello/commits')
    expect(calledUrl).not.toContain('author=')
  })

  it('repos.getReadme GETs the readme endpoint', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse({ name: 'README.md', encoding: 'base64', content: 'aGk=' })
      }),
    )
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.getReadme',
      args: { owner: 'octo', repo: 'hello' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/octo/hello/readme')
    expect((result.data as { encoding: string }).encoding).toBe('base64')
  })

  it('search.code templates the q + per_page query params', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse({ total_count: 1, items: [{ path: 'src/index.ts' }] })
      }),
    )
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'search.code',
      args: { q: 'addClass in:file language:js repo:octo/hello', per_page: 10 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/search/code?')
    expect(calledUrl).toContain('per_page=10')
    // URLSearchParams encodes spaces as `+` and reserved chars (`:`, `/`) percent-escaped.
    expect(calledUrl).toContain('q=addClass+in%3Afile+language%3Ajs+repo%3Aocto%2Fhello')
    expect((result.data as { total_count: number }).total_count).toBe(1)
  })

  it('orgs.checkMembership probes /orgs/{org}/members/{user} with 204/404 semantics', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return new Response(null, { status: 204 })
      }),
    )
    const member = await adapter.executeRead!({
      source: source(),
      capabilityName: 'orgs.checkMembership',
      args: { org: 'tangle-network', user: 'octocat' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/orgs/tangle-network/members/octocat')
    expect(member.data).toEqual({ exists: true })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })),
    )
    const notMember = await adapter.executeRead!({
      source: source(),
      capabilityName: 'orgs.checkMembership',
      args: { org: 'tangle-network', user: 'octocat' },
      idempotencyKey: 'k',
    })
    expect(notMember.data).toEqual({ exists: false })
  })

  it('read existence checks still surface CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'activity.checkStarred',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- pulls.create ----------

  it('pulls.create POSTs the PR body and returns committed status', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ number: 42, html_url: 'https://github.com/o/r/pull/42', state: 'open' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'pulls.create',
      args: {
        owner: 'octo',
        repo: 'hello',
        title: 'My PR',
        head: 'feature-x',
        base: 'main',
        body: 'Fixes #1',
        draft: true,
      },
      idempotencyKey: 'idemp-pr-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toContain('/repos/octo/hello/pulls')
    expect(calledBody).toMatchObject({
      title: 'My PR',
      head: 'feature-x',
      base: 'main',
      body: 'Fixes #1',
      draft: true,
    })
    expect(result.status).toBe('committed')
    expect((result as { data: { number: number } }).data.number).toBe(42)
    expect((result as { committedAt: number }).committedAt).toBeTypeOf('number')
    expect((result as { idempotentReplay: boolean }).idempotentReplay).toBe(false)
  })

  it('pulls.create rejects missing required path args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.create',
        args: { repo: 'hello', title: 't', head: 'h', base: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: owner/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.create',
        args: { owner: 'octo', title: 't', head: 'h', base: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: repo/)
  })

  it('pulls.create surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.create',
        args: { owner: 'octo', repo: 'hello', title: 't', head: 'h', base: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- pulls.merge ----------

  it('pulls.merge PUTs the merge body with merge_method', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ sha: 'abc123', merged: true, message: 'Pull Request successfully merged' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'pulls.merge',
      args: {
        owner: 'octo',
        repo: 'hello',
        pull_number: 42,
        commit_title: 'Merge #42',
        merge_method: 'squash',
      },
      idempotencyKey: 'idemp-merge-1',
    })
    expect(calledMethod).toBe('PUT')
    expect(calledUrl).toContain('/repos/octo/hello/pulls/42/merge')
    expect(calledBody).toMatchObject({
      commit_title: 'Merge #42',
      merge_method: 'squash',
    })
    expect(result.status).toBe('committed')
    expect((result as { data: { merged: boolean } }).data.merged).toBe(true)
  })

  it('pulls.merge rejects missing required path args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.merge',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: pull_number/)
  })

  it('pulls.merge surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.merge',
        args: { owner: 'octo', repo: 'hello', pull_number: 42 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- issues.createComment ----------

  it('issues.createComment POSTs the comment body to the issue endpoint', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ id: 555, body: 'lgtm', html_url: 'https://github.com/o/r/issues/1#issuecomment-555' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'issues.createComment',
      args: { owner: 'octo', repo: 'hello', issue_number: 1, body: 'lgtm' },
      idempotencyKey: 'idemp-cmt-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toContain('/repos/octo/hello/issues/1/comments')
    expect(calledBody).toMatchObject({ body: 'lgtm' })
    expect(result.status).toBe('committed')
    expect((result as { data: { id: number } }).data.id).toBe(555)
  })

  it('issues.createComment rejects missing required path args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'issues.createComment',
        args: { owner: 'octo', repo: 'hello', body: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: issue_number/)
  })

  it('issues.createComment surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'issues.createComment',
        args: { owner: 'octo', repo: 'hello', issue_number: 1, body: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- pulls.reviews.create ----------

  it('pulls.reviews.create POSTs the review event to the PR reviews endpoint', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ id: 777, state: 'APPROVED', user: { login: 'octo' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'pulls.reviews.create',
      args: { owner: 'octo', repo: 'hello', pull_number: 42, event: 'APPROVE', body: 'shipit' },
      idempotencyKey: 'idemp-rev-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toContain('/repos/octo/hello/pulls/42/reviews')
    expect(calledBody).toMatchObject({ event: 'APPROVE', body: 'shipit' })
    expect(result.status).toBe('committed')
    expect((result as { data: { state: string } }).data.state).toBe('APPROVED')
  })

  it('pulls.reviews.create rejects missing required path args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.reviews.create',
        args: { owner: 'octo', repo: 'hello', event: 'APPROVE' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: pull_number/)
  })

  it('pulls.reviews.create surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'pulls.reviews.create',
        args: { owner: 'octo', repo: 'hello', pull_number: 42, event: 'APPROVE' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
