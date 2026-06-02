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

  it('manifest exposes the new write capabilities', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'issues.create',
        'issues.createComment',
        'issues.search',
        'issues.update',
        'pulls.create',
        'pulls.merge',
        'pulls.reviews.create',
        'repositories.get',
      ].sort(),
    )
    const mutations = adapter.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const m of mutations) {
      expect((m as { cas: string }).cas).toBeDefined()
      expect((m as { externalEffect: boolean }).externalEffect).toBe(true)
    }
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
