import { afterEach, describe, expect, it, vi } from 'vitest'
import { wrikeConnector } from '../src/connectors/adapters/wrike.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wrike_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'wrike',
    label: 'wrike test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'wrike_token' },
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

describe('wrike adapter manifest', () => {
  it('classifies itself as the other category and exposes the wrike kind', () => {
    expect(wrikeConnector.manifest.kind).toBe('wrike')
    expect(wrikeConnector.manifest.category).toBe('other')
    expect(wrikeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth', () => {
    const auth = wrikeConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers tasks, folders, projects, comments, attachments, and lifecycle deletes/completes', () => {
    const names = wrikeConnector.manifest.capabilities.map((c) => c.name).sort()
    for (const expected of [
      'tasks.create',
      'tasks.update',
      'tasks.delete',
      'tasks.complete',
      'folders.create',
      'folders.delete',
      'projects.create',
      'comments.add',
      'comments.update',
      'attachments.upload',
      'tasks.find',
      'folders.find',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks new mutations as native-idempotency with external effect', () => {
    const targets = ['tasks.delete', 'tasks.complete', 'folders.delete', 'comments.update']
    for (const t of targets) {
      const cap = wrikeConnector.manifest.capabilities.find((c) => c.name === t)
      expect(cap?.class).toBe('mutation')
      if (cap?.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('wrike tasks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v4/tasks/{taskId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )

    const result = await wrikeConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.delete',
      args: { taskId: 'IEABCDEF' },
      idempotencyKey: 'k-t-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v4/tasks/IEABCDEF')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      wrikeConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.delete',
        args: { taskId: 'IEABCDEF' },
        idempotencyKey: 'k-t-del-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('wrike tasks.complete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PUT to /api/v4/tasks/{taskId} with status=Completed', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body as string | undefined
        return jsonResponse({ data: [{ id: 'IEABCDEF', status: 'Completed' }] })
      }),
    )

    const result = await wrikeConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.complete',
      args: { taskId: 'IEABCDEF' },
      idempotencyKey: 'k-t-cmp',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v4/tasks/IEABCDEF')
    expect(requestBody ?? '').toContain('Completed')
  })
})

describe('wrike folders.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v4/folders/{folderId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )

    await wrikeConnector.executeMutation!({
      source: source(),
      capabilityName: 'folders.delete',
      args: { folderId: 'IEFOLDER1' },
      idempotencyKey: 'k-f-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v4/folders/IEFOLDER1')
  })
})

describe('wrike comments.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PUT to /api/v4/comments/{commentId} with the new text', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body as string | undefined
        return jsonResponse({ data: [{ id: 'IECMT1', text: 'edited' }] })
      }),
    )

    const result = await wrikeConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.update',
      args: { commentId: 'IECMT1', text: 'edited' },
      idempotencyKey: 'k-c-upd',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v4/comments/IECMT1')
    expect(requestBody ?? '').toContain('edited')
  })
})
