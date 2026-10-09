import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubConnector, type ResolvedDataSource } from '../src/connectors/index'

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

  it('repos.getCombinedStatusForRef and checks.listForRef read what a ref reports', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))
        return jsonResponse({ state: 'success', statuses: [{ context: 'deploy/host-1', state: 'success' }] })
      }),
    )

    const status = await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.getCombinedStatusForRef',
      args: { owner: 'acme', repo: 'test-app', ref: 'abc123' },
      idempotencyKey: 'k',
    })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'checks.listForRef',
      args: { owner: 'acme', repo: 'test-app', ref: 'main' },
      idempotencyKey: 'k',
    })
    expect(urls[0]).toMatch(/\/repos\/acme\/test-app\/commits\/abc123\/status(\?|$)/)
    expect(urls[1]).toMatch(/\/repos\/acme\/test-app\/commits\/main\/check-runs(\?|$)/)
    expect((status.data as { statuses: { context: string }[] }).statuses[0].context).toBe('deploy/host-1')
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

  it('repos.listForAuthenticatedUser lists the repositories the token can read', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse([{ full_name: 'acme/private-skills', private: true, default_branch: 'main' }])
      }),
    )
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.listForAuthenticatedUser',
      args: { sort: 'pushed', per_page: 100 },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/user/repos')
    expect(calledUrl).toContain('sort=pushed')
    expect(calledUrl).toContain('per_page=100')
    expect(JSON.stringify(result)).toContain('acme/private-skills')
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

  it('every paged listing can actually reach page two', async () => {
    // A listing that offers `per_page` but no `page` caps the caller at the
    // first 100 results with no way to ask for the rest — a silent truncation.
    const paged = [
      ['pulls.listReviews', { owner: 'a', repo: 'b', pull_number: 1 }],
      ['pulls.listReviewComments', { owner: 'a', repo: 'b', pull_number: 1 }],
      ['issues.listComments', { owner: 'a', repo: 'b', issue_number: 1 }],
      ['repos.listLabels', { owner: 'a', repo: 'b' }],
      ['repos.listBranches', { owner: 'a', repo: 'b' }],
      ['repos.listForAuthenticatedUser', {}],
      ['pulls.listFiles', { owner: 'a', repo: 'b', pull_number: 1 }],
      ['repos.getCombinedStatusForRef', { owner: 'a', repo: 'b', ref: 'main' }],
      ['checks.listForRef', { owner: 'a', repo: 'b', ref: 'main' }],
    ] as const

    for (const [capabilityName, args] of paged) {
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
        capabilityName,
        args: { ...args, per_page: 100, page: 2 },
        idempotencyKey: 'k',
      })
      expect(calledUrl, capabilityName).toContain('per_page=100')
      expect(calledUrl, capabilityName).toContain('page=2')
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

  // ---------- Git Data: propose a change on a new branch ----------

  const TREE_1 = '7e9a071fd4e87b437dca9a7798e40e714078ca22'
  const TREE_2 = 'ab49d842fdea494a587aaf0232e3234d8555f7ce'
  const COMMIT_1 = '21b8c13e0d6a8c1f6a54c9d1d7f3f2b3a4c5d6e7'
  const COMMIT_2 = '60568543335bbaf23bce528e7a6092fae10d1974'

  function refusingFetch() {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('repos.getBranch refuses a commit sha as the branch, naming the field and the read to use instead', async () => {
    const fetchMock = refusingFetch()
    const read = adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.getBranch',
      args: { owner: 'octo', repo: 'hello', branch: COMMIT_2 },
      idempotencyKey: 'k-branch-sha',
    })
    await expect(read).rejects.toMatchObject({
      name: 'InvalidCapabilityArgument',
      field: 'branch',
      status: 400,
      message: expect.stringMatching(/invalid argument "branch".*commit sha, not a branch name.*git\.getCommit/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('repos.getBranch refuses a ref path where the bare branch name belongs', async () => {
    const fetchMock = refusingFetch()
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.getBranch',
      args: { owner: 'octo', repo: 'hello', branch: 'refs/heads/main' },
      idempotencyKey: 'k-branch-ref',
    })).rejects.toMatchObject({ field: 'branch', message: expect.stringContaining('bare branch name') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('repos.getBranch still reads a branch name made of hex characters that is not a full sha', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ name: 'deadbeef', commit: { sha: COMMIT_1 } })
    }))
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'repos.getBranch',
      args: { owner: 'octo', repo: 'hello', branch: 'deadbeef' },
      idempotencyKey: 'k-branch-hex',
    })
    expect(calledUrl).toContain('/repos/octo/hello/branches/deadbeef')
  })

  it('git.getCommit reads a commit object by sha', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ sha: COMMIT_2, tree: { sha: TREE_2 }, parents: [{ sha: COMMIT_1 }] })
    }))
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'git.getCommit',
      args: { owner: 'octo', repo: 'hello', commit_sha: COMMIT_2 },
      idempotencyKey: 'k-get-commit',
    })
    expect(calledUrl).toContain(`/repos/octo/hello/git/commits/${COMMIT_2}`)
    expect(result.data).toMatchObject({ tree: { sha: TREE_2 }, parents: [{ sha: COMMIT_1 }] })
  })

  it('git.createRef refuses a bare branch name for ref before anything is written', async () => {
    const fetchMock = refusingFetch()
    await expect(adapter.executeMutation!({
      source: source(),
      capabilityName: 'git.createRef',
      args: { owner: 'octo', repo: 'hello', ref: 'gtm-agent/hero', sha: COMMIT_2 },
      idempotencyKey: 'k-ref-bare',
    })).rejects.toMatchObject({ field: 'ref', message: expect.stringMatching(/invalid argument "ref".*refs\/heads/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('git.createCommit names the parent that is a branch name instead of a sha', async () => {
    const fetchMock = refusingFetch()
    await expect(adapter.executeMutation!({
      source: source(),
      capabilityName: 'git.createCommit',
      args: { owner: 'octo', repo: 'hello', message: 'Shorten hero', tree: TREE_2, parents: [COMMIT_1, 'main'] },
      idempotencyKey: 'k-commit-parent',
    })).rejects.toMatchObject({ field: 'parents[1]' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('git.createTree POSTs base_tree and entries only, keeping owner/repo out of the body', async () => {
    let calledUrl = ''
    let calledBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ sha: TREE_2 })
    }))
    const tree = [{ path: 'src/routes/home.tsx', mode: '100644', type: 'blob', content: 'export {}\n' }]
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'git.createTree',
      args: { owner: 'octo', repo: 'hello', base_tree: TREE_1, tree },
      idempotencyKey: 'k-tree',
    })
    expect(calledUrl).toContain('/repos/octo/hello/git/trees')
    expect(calledBody).toEqual({ base_tree: TREE_1, tree })
    expect(result.status).toBe('committed')
  })

  it('git.createCommit POSTs message, tree and parents', async () => {
    let calledBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ sha: COMMIT_2 })
    }))
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'git.createCommit',
      args: { owner: 'octo', repo: 'hello', message: 'Shorten hero', tree: TREE_2, parents: [COMMIT_1] },
      idempotencyKey: 'k-commit',
    })
    expect(calledBody).toEqual({ message: 'Shorten hero', tree: TREE_2, parents: [COMMIT_1] })
  })

  it('git.createRef creates a new branch ref at a commit', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ ref: 'refs/heads/gtm-agent/hero', object: { sha: COMMIT_2 } })
    }))
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'git.createRef',
      args: { owner: 'octo', repo: 'hello', ref: 'refs/heads/gtm-agent/hero', sha: COMMIT_2 },
      idempotencyKey: 'k-ref',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toContain('/repos/octo/hello/git/refs')
    expect(calledBody).toEqual({ ref: 'refs/heads/gtm-agent/hero', sha: COMMIT_2 })
  })

  it('exposes no capability that moves an existing ref or writes file contents in place', () => {
    const names = adapter.manifest.capabilities.map((capability) => capability.name)
    expect(names).toEqual(expect.arrayContaining(['git.createTree', 'git.createCommit', 'git.createRef']))
    expect(names.filter((name) => /updateRef|refs\.update|contents|deleteRef/i.test(name))).toEqual([])
  })

  it('git.getTree passes recursive as a query parameter', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ sha: 'tree1', tree: [] })
    }))
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'git.getTree',
      args: { owner: 'octo', repo: 'hello', tree_sha: 'tree1', recursive: '1' },
      idempotencyKey: 'k-get-tree',
    })
    expect(calledUrl).toContain('/repos/octo/hello/git/trees/tree1')
    expect(new URL(calledUrl).searchParams.get('recursive')).toBe('1')
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

  // ---------- pulls.propose ----------

  describe('pulls.propose', () => {
    const BASE_HEAD = '21b8c13e0d6a8c1f6a54c9d1d7f3f2b3a4c5d6e7'
    const BASE_TREE = '7e9a071fd4e87b437dca9a7798e40e714078ca22'
    const NEW_TREE = 'ab49d842fdea494a587aaf0232e3234d8555f7ce'
    const NEW_COMMIT = '60568543335bbaf23bce528e7a6092fae10d1974'
    const args = {
      owner: 'octo',
      repo: 'hello',
      base: 'main',
      branch: 'gtm-agent/hero-copy',
      title: 'Fix the hero headline wrap',
      body: 'The headline wrapped to four lines at 390 px.',
      files: [
        { path: 'src/routes/_index.tsx', content: 'export default 1\n' },
        { path: 'bin/run.sh', content: '#!/bin/sh\n', mode: '100755' },
        { path: 'docs/old.md', delete: true },
      ],
    }

    interface Call { method: string; path: string; body: unknown }

    function githubFake(overrides: Partial<Record<string, (call: Call) => Response>> = {}) {
      const calls: Call[] = []
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const call = { method: init?.method ?? 'GET', path: url.pathname + url.search, body: init?.body ? JSON.parse(init.body as string) : undefined }
        calls.push(call)
        const key = `${call.method} ${url.pathname}`
        const override = overrides[key]
        if (override) return override(call)
        switch (key) {
          case 'GET /repos/octo/hello/branches/main':
            return jsonResponse({ name: 'main', commit: { sha: BASE_HEAD, commit: { tree: { sha: BASE_TREE } } } })
          case 'POST /repos/octo/hello/git/trees':
            return jsonResponse({ sha: NEW_TREE, tree: [] })
          case 'POST /repos/octo/hello/git/commits':
            return jsonResponse({ sha: NEW_COMMIT })
          case 'POST /repos/octo/hello/git/refs':
            return jsonResponse({ ref: 'refs/heads/gtm-agent/hero-copy', object: { sha: NEW_COMMIT } })
          case 'POST /repos/octo/hello/pulls':
            return jsonResponse({ number: 123, html_url: 'https://github.com/octo/hello/pull/123', title: args.title, state: 'open', draft: true })
          case 'GET /repos/octo/hello/pulls/123/files':
            return jsonResponse([
              { filename: 'src/routes/_index.tsx', status: 'modified', additions: 1, deletions: 3 },
              { filename: 'bin/run.sh', status: 'added', additions: 1, deletions: 0 },
              { filename: 'docs/old.md', status: 'removed', additions: 0, deletions: 12 },
            ])
          default:
            return jsonResponse({ message: `unexpected ${key}` }, { status: 500 })
        }
      })
      vi.stubGlobal('fetch', fetchMock)
      return calls
    }

    const propose = (input: Record<string, unknown>) => adapter.executeMutation!({
      source: source(),
      capabilityName: 'pulls.propose',
      args: input,
      idempotencyKey: 'k-propose',
    })

    it('is a published external-effect mutation whose schema names the change', () => {
      const capability = adapter.manifest.capabilities.find((entry) => entry.name === 'pulls.propose')
      expect(capability).toMatchObject({ class: 'mutation', externalEffect: true })
      expect((capability?.parameters as { required?: string[] }).required).toEqual(['owner', 'repo', 'base', 'branch', 'title', 'files'])
      // Published patterns are compiled by model providers; the branch rules stay in code.
      expect(JSON.stringify(capability?.parameters)).not.toContain('(?')
    })

    it('reads the base head, writes tree, commit, new branch and a draft pull request, then reads its files', async () => {
      const calls = githubFake()
      const result = await propose(args)

      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'GET /repos/octo/hello/branches/main',
        'POST /repos/octo/hello/git/trees',
        'POST /repos/octo/hello/git/commits',
        'POST /repos/octo/hello/git/refs',
        'POST /repos/octo/hello/pulls',
        'GET /repos/octo/hello/pulls/123/files?per_page=100',
      ])
      expect(calls[1].body).toEqual({
        base_tree: BASE_TREE,
        tree: [
          { path: 'src/routes/_index.tsx', mode: '100644', type: 'blob', content: 'export default 1\n' },
          { path: 'bin/run.sh', mode: '100755', type: 'blob', content: '#!/bin/sh\n' },
          { path: 'docs/old.md', mode: '100644', type: 'blob', sha: null },
        ],
      })
      expect(calls[2].body).toEqual({ message: args.title, tree: NEW_TREE, parents: [BASE_HEAD] })
      expect(calls[3].body).toEqual({ ref: 'refs/heads/gtm-agent/hero-copy', sha: NEW_COMMIT })
      expect(calls[4].body).toEqual({ title: args.title, head: 'gtm-agent/hero-copy', base: 'main', body: args.body, draft: true })
      expect(result).toMatchObject({
        status: 'committed',
        data: {
          pullRequest: { number: 123, url: 'https://github.com/octo/hello/pull/123', title: args.title, state: 'open', draft: true },
          repository: 'octo/hello',
          base: 'main',
          branch: 'gtm-agent/hero-copy',
          commit: { sha: NEW_COMMIT, url: `https://github.com/octo/hello/commit/${NEW_COMMIT}` },
          files: [
            { path: 'src/routes/_index.tsx', status: 'modified', additions: 1, deletions: 3 },
            { path: 'bin/run.sh', status: 'added', additions: 1, deletions: 0 },
            { path: 'docs/old.md', status: 'removed', additions: 0, deletions: 12 },
          ],
        },
      })
    })

    it('uses the commit message when given and omits an absent body', async () => {
      const calls = githubFake()
      const { body: _body, ...withoutBody } = args
      await propose({ ...withoutBody, commit_message: 'fix(hero): one-line headline' })
      expect(calls[2].body).toMatchObject({ message: 'fix(hero): one-line headline' })
      expect(calls[4].body).toEqual({ title: args.title, head: 'gtm-agent/hero-copy', base: 'main', draft: true })
    })

    it.each([
      ['branch equal to base', { branch: 'main' }, /branch.*new branch, not the base/],
      ['a default branch name', { branch: 'master' }, /default branch name/],
      ['a commit sha as the branch', { branch: NEW_COMMIT }, /commit sha/],
      ['a refs/ path as the base', { base: 'refs/heads/main' }, /bare branch name/],
      ['a branch with ..', { branch: 'a..b' }, /plain git branch name/],
      ['no files', { files: [] }, /at least one file/],
      ['an absolute path', { files: [{ path: '/etc/passwd', content: 'x' }] }, /repository-relative/],
      ['a .. segment', { files: [{ path: 'src/../x', content: 'x' }] }, /repository-relative/],
      ['a write inside .git', { files: [{ path: '.git/config', content: 'x' }] }, /inside \.git/],
      ['a duplicate path', { files: [{ path: 'a.md', content: 'x' }, { path: 'a.md', content: 'y' }] }, /listed twice/],
      ['a file without content', { files: [{ path: 'a.md' }] }, /content.*required/],
      ['content on a delete', { files: [{ path: 'a.md', delete: true, content: 'x' }] }, /no content/],
      ['an unknown file field', { files: [{ path: 'a.md', content: 'x', sha: 'abc' }] }, /not a file field/],
      ['an unknown argument', { draft: false }, /not an argument of pulls.propose/],
      ['too many files', { files: Array.from({ length: 51 }, (_, index) => ({ path: `f${index}.md`, content: 'x' })) }, /at most 50 files/],
      ['an oversized file', { files: [{ path: 'big.txt', content: 'x'.repeat(1_000_001) }] }, /larger than 1000000 bytes/],
    ])('refuses %s before any request', async (_name, change, message) => {
      const calls = githubFake()
      await expect(propose({ ...args, ...change })).rejects.toThrow(message)
      expect(calls).toEqual([])
    })

    it('names the existing branch when GitHub refuses to create it, after writing only unreferenced objects', async () => {
      const calls = githubFake({
        'POST /repos/octo/hello/git/refs': () => jsonResponse({ message: 'Reference already exists' }, { status: 422 }),
      })
      await expect(propose(args)).rejects.toThrow(/gtm-agent\/hero-copy already exists in octo\/hello; name a new branch/)
      expect(calls.some((call) => call.path.endsWith('/pulls'))).toBe(false)
    })

    it('names the created branch and commit when opening the pull request fails', async () => {
      githubFake({
        'POST /repos/octo/hello/pulls': () => jsonResponse({ message: 'Validation Failed' }, { status: 422 }),
      })
      await expect(propose(args)).rejects.toThrow(
        new RegExp(`branch gtm-agent/hero-copy at commit ${NEW_COMMIT} exists in octo/hello, but opening the pull request failed; call pulls.create`),
      )
    })

    it('still returns the open pull request when its file list cannot be read', async () => {
      githubFake({
        'GET /repos/octo/hello/pulls/123/files': () => jsonResponse({ message: 'boom' }, { status: 500 }),
      })
      const result = await propose(args) as { data: { files: Array<{ path: string; status: string }> } }
      expect(result.data.files.map((file) => [file.path, file.status])).toEqual([
        ['src/routes/_index.tsx', 'modified'],
        ['bin/run.sh', 'modified'],
        ['docs/old.md', 'removed'],
      ])
    })

    it('reports a throttled step as the rate-limited soft failure, not a commit', async () => {
      githubFake({
        'POST /repos/octo/hello/git/trees': () => new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }),
      })
      await expect(propose(args)).resolves.toMatchObject({ status: 'rate-limited', retryAfterMs: 3000 })
    })

    it('other mutations still run through the declarative connector', async () => {
      const calls = githubFake({
        'POST /repos/octo/hello/issues': () => jsonResponse({ number: 9 }),
      })
      const result = await adapter.executeMutation!({
        source: source(), capabilityName: 'issues.create', args: { owner: 'octo', repo: 'hello', title: 'x' }, idempotencyKey: 'k',
      })
      expect(result.status).toBe('committed')
      expect(calls.map((call) => call.path)).toEqual(['/repos/octo/hello/issues'])
    })
  })
})
