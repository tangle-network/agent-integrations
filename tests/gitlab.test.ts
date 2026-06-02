import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  gitlabConnector,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gitlab_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gitlab',
    label: 'Tangle GitLab',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'glpat_token_123',
    },
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

describe('gitlab adapter writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes merge_requests.create, merge_requests.accept, notes.create as mutations', () => {
    const names = gitlabConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('merge_requests.create')
    expect(names).toContain('merge_requests.accept')
    expect(names).toContain('notes.create')

    const byName = Object.fromEntries(
      gitlabConnector.manifest.capabilities.map((c) => [c.name, c]),
    )
    expect(byName['merge_requests.create']?.class).toBe('mutation')
    expect(byName['merge_requests.accept']?.class).toBe('mutation')
    expect(byName['notes.create']?.class).toBe('mutation')
  })

  describe('merge_requests.create', () => {
    it('POSTs to /projects/{id}/merge_requests with the MR payload as body', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} })
        return jsonResponse({ id: 9001, iid: 42, web_url: 'https://gitlab.example/mr/42' }, { status: 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await gitlabConnector.executeMutation!({
        source: source(),
        capabilityName: 'merge_requests.create',
        args: {
          id: 'group%2Frepo',
          source_branch: 'feature/x',
          target_branch: 'main',
          title: 'Add feature X',
          description: 'desc body',
        },
        idempotencyKey: 'idemp-mr-create-1',
      })

      expect(result.status).toBe('committed')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/projects/group%252Frepo/merge_requests')
      expect(calls[0]!.init.method).toBe('POST')
      const body = JSON.parse(String(calls[0]!.init.body))
      expect(body).toMatchObject({
        id: 'group%2Frepo',
        source_branch: 'feature/x',
        target_branch: 'main',
        title: 'Add feature X',
        description: 'desc body',
      })
      const headers = calls[0]!.init.headers as Record<string, string>
      expect(headers['PRIVATE-TOKEN']).toBe('glpat_token_123')
    })

    it('rejects missing required path argument id', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'merge_requests.create',
          args: { source_branch: 'a', target_branch: 'b', title: 't' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/missing required argument: id/)
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })),
      )
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'merge_requests.create',
          args: {
            id: 'group%2Frepo',
            source_branch: 'feature/x',
            target_branch: 'main',
            title: 't',
          },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('merge_requests.accept', () => {
    it('PUTs to /projects/{id}/merge_requests/{merge_request_iid}/merge with optional commit message', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} })
        return jsonResponse({ id: 9001, iid: 42, state: 'merged' })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await gitlabConnector.executeMutation!({
        source: source(),
        capabilityName: 'merge_requests.accept',
        args: {
          id: '123',
          merge_request_iid: 42,
          merge_commit_message: 'Merge feature X',
        },
        idempotencyKey: 'idemp-mr-accept-1',
      })

      expect(result.status).toBe('committed')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/projects/123/merge_requests/42/merge')
      expect(calls[0]!.init.method).toBe('PUT')
      const body = JSON.parse(String(calls[0]!.init.body))
      expect(body.merge_commit_message).toBe('Merge feature X')
    })

    it('rejects missing required arg merge_request_iid', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'merge_requests.accept',
          args: { id: '123' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/missing required argument: merge_request_iid/)
    })

    it('surfaces CredentialsExpired on 403', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ message: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })),
      )
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'merge_requests.accept',
          args: { id: '123', merge_request_iid: 42 },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('notes.create', () => {
    it('POSTs to /projects/{id}/issues/{issue_iid}/notes with the comment body', async () => {
      const calls: Array<{ url: string; init: RequestInit }> = []
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} })
        return jsonResponse({ id: 555, body: 'looks good' }, { status: 201 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await gitlabConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.create',
        args: {
          id: 'group%2Frepo',
          issue_iid: 7,
          body: 'looks good',
        },
        idempotencyKey: 'idemp-note-1',
      })

      expect(result.status).toBe('committed')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/projects/group%252Frepo/issues/7/notes')
      expect(calls[0]!.init.method).toBe('POST')
      const body = JSON.parse(String(calls[0]!.init.body))
      expect(body).toMatchObject({ id: 'group%2Frepo', issue_iid: 7, body: 'looks good' })
    })

    it('rejects missing required arg issue_iid', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'notes.create',
          args: { id: '123', body: 'hi' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/missing required argument: issue_iid/)
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })),
      )
      await expect(
        gitlabConnector.executeMutation!({
          source: source(),
          capabilityName: 'notes.create',
          args: { id: '123', issue_iid: 7, body: 'hi' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })
})
