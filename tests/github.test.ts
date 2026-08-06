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
        'issues.get',
        'issues.list',
        'issues.listComments',
        'issues.search',
        'orgs.checkMembership',
        'pulls.get',
        'pulls.list',
        'pulls.listFiles',
        'pulls.listReviewComments',
        'pulls.listReviews',
        'repos.getReadme',
        'repos.listBranches',
        'repos.listCommits',
        'repos.listLabels',
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

  it('pulls.get reads one pull request by number', async () => {
    let calledUrl = ''
    let calledMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input)
        calledMethod = init?.method ?? ''
        return jsonResponse({
          number: 65,
          title: 'Batch changes from baseline',
          base: { repo: { full_name: 'acme/test-app', name: 'test-app', owner: { login: 'acme' } } },
        })
      }),
    )

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'pulls.get',
      args: { owner: 'acme', repo: 'test-app', pull_number: 65 },
      idempotencyKey: 'k',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toMatch(/\/repos\/acme\/test-app\/pulls\/65$/)
    // The base repo rides the PR, which is what lets a caller derive the
    // repository identity without a second read.
    expect((result.data as { base: { repo: { full_name: string } } }).base.repo.full_name).toBe(
      'acme/test-app',
    )
  })

  it('pulls.list passes state/sort/per_page through as query params', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ number: 65, title: 'Batch changes from baseline' }])
      }),
    )

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'pulls.list',
      args: { owner: 'acme', repo: 'test-app', state: 'open', sort: 'updated', per_page: 20 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/pulls')
    expect(calledUrl).toContain('state=open')
    expect(calledUrl).toContain('sort=updated')
    expect(calledUrl).toContain('per_page=20')
    expect((result.data as { number: number }[])[0].number).toBe(65)
  })

  it('pulls.list drops every optional query param the caller omits', async () => {
    // The optionals are declared as bare `'{state}'`-style placeholders, so a
    // call that supplies none must send NONE of them — not `state=undefined`,
    // and not the literal `{state}`. `renderQueryValue` returns undefined for an
    // absent exact placeholder and the URL builder skips the key; this pins that
    // contract on the capability rather than trusting it from a distance.
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
      capabilityName: 'pulls.list',
      args: { owner: 'acme', repo: 'test-app' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/pulls')
    for (const key of ['state', 'sort', 'direction', 'per_page']) {
      expect(calledUrl).not.toContain(`${key}=`)
    }
    expect(calledUrl).not.toContain('undefined')
    expect(calledUrl).not.toContain('%7B')
  })

  it('issues.list drops every optional query param the caller omits', async () => {
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
      capabilityName: 'issues.list',
      args: { owner: 'acme', repo: 'test-app' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/issues')
    for (const key of ['state', 'labels', 'sort', 'direction', 'per_page']) {
      expect(calledUrl).not.toContain(`${key}=`)
    }
    expect(calledUrl).not.toContain('undefined')
    expect(calledUrl).not.toContain('%7B')
  })

  it('pulls.listFiles reads the changed files of a pull request', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ filename: 'index.html', status: 'modified', patch: '@@ -1 +1 @@' }])
      }),
    )

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'pulls.listFiles',
      args: { owner: 'acme', repo: 'test-app', pull_number: 65, per_page: 50 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toMatch(/\/repos\/acme\/test-app\/pulls\/65\/files/)
    expect(calledUrl).toContain('per_page=50')
    expect((result.data as { filename: string }[])[0].filename).toBe('index.html')
  })

  it('issues.get and issues.listComments address the issue by number', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))
        return jsonResponse([])
      }),
    )

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'issues.get',
      args: { owner: 'acme', repo: 'test-app', issue_number: 12 },
      idempotencyKey: 'k',
    })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'issues.listComments',
      args: { owner: 'acme', repo: 'test-app', issue_number: 12 },
      idempotencyKey: 'k',
    })
    expect(urls[0]).toMatch(/\/repos\/acme\/test-app\/issues\/12$/)
    expect(urls[1]).toMatch(/\/repos\/acme\/test-app\/issues\/12\/comments/)
  })

  it('pulls.listReviews reads the submitted reviews of a pull request', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ id: 1, state: 'APPROVED' }])
      }),
    )
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'pulls.listReviews',
      args: { owner: 'acme', repo: 'test-app', pull_number: 7, per_page: 30 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/pulls/7/reviews')
    expect(calledUrl).toContain('per_page=30')
  })

  it('pulls.listReviewComments reads the inline comments of a pull request', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ id: 2, path: 'src/a.ts' }])
      }),
    )
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'pulls.listReviewComments',
      args: { owner: 'acme', repo: 'test-app', pull_number: 7 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/pulls/7/comments')
  })

  it('repos.listLabels reads the labels a repository defines', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ name: 'bug' }])
      }),
    )
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.listLabels',
      args: { owner: 'acme', repo: 'test-app', per_page: 50 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/labels')
    expect(calledUrl).toContain('per_page=50')
  })

  it('repos.listBranches reads a repository branch list', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ name: 'develop' }])
      }),
    )
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.listBranches',
      args: { owner: 'acme', repo: 'test-app' },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/repos/acme/test-app/branches')
  })

  it('every new capability is a READ — no mutation slipped into this set', () => {
    const added = [
      'pulls.get',
      'pulls.list',
      'pulls.listFiles',
      'pulls.listReviews',
      'pulls.listReviewComments',
      'issues.get',
      'issues.list',
      'issues.listComments',
      'repos.listLabels',
      'repos.listBranches',
    ]
    for (const name of added) {
      const cap = adapter.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `${name} is missing from the manifest`).toBeDefined()
      expect(cap?.class, `${name} must be a read`).toBe('read')
    }
  })

  // ---------- provider throttles and hard failures on reads ----------

  it('repositories.get throws ProviderRateLimited on a 429 — never resolves as a successful read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '2' },
          }),
      ),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'repositories.get',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({
      name: 'ProviderRateLimited',
      status: 429,
      retryAfterMs: 2000,
      body: { message: 'API rate limit exceeded' },
      message: expect.stringMatching(/rate limit/),
    })
  })

  it('repositories.get throws with status + body on a generic 5xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'repositories.get',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/HTTP 500.*Server Error/)
  })

  it('repositories.get throws on a 409 conflict instead of returning the error body as data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'repositories.get',
        args: { owner: 'octo', repo: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/HTTP 409/)
  })

  it('issues.create still reports a 429 as the rate-limited soft failure, not a commit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '2' },
          }),
      ),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'issues.create',
      args: { owner: 'octo', repo: 'hello', title: 'throttled' },
      idempotencyKey: 'k',
    })
    expect(result).toMatchObject({ status: 'rate-limited', retryAfterMs: 2000 })
  })

  it('test() reports a throttled health probe as ok: false, not green', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '2' },
          }),
      ),
    )
    const result = await adapter.test(source())
    expect(result.ok).toBe(false)
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
