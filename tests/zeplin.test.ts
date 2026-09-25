import { afterEach, describe, expect, it, vi } from 'vitest'
import { zeplinConnector } from '../src/connectors/adapters/zeplin.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zeplin_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zeplin',
    label: 'Zeplin test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'zeplin_token' },
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

describe('zeplin adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zeplinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('zeplin notes.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /v1/projects/{projectId}/screens/{screenId}/notes/{noteId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'note_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zeplinConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.update',
      args: {
        projectId: 'proj_a',
        screenId: 'scr_b',
        noteId: 'note_1',
        content: 'updated content',
        color: 'red',
      },
      idempotencyKey: 'k-1',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe(
      'https://api.zeplin.io/v1/projects/proj_a/screens/scr_b/notes/note_1',
    )
    expect(capturedBody).toEqual({ content: 'updated content', color: 'red' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zeplinConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.update',
        args: {
          projectId: 'proj_a',
          screenId: 'scr_b',
          noteId: 'note_1',
          content: 'x',
          color: 'red',
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('zeplin notes.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the note', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zeplinConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.delete',
      args: { projectId: 'proj_a', screenId: 'scr_b', noteId: 'note_1' },
      idempotencyKey: 'k-2',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe(
      'https://api.zeplin.io/v1/projects/proj_a/screens/scr_b/notes/note_1',
    )
    expect(result.status).toBe('committed')
  })
})

describe('zeplin projects.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/projects', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse([{ id: 'p1' }, { id: 'p2' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zeplinConnector.executeRead!({
      source: source(),
      capabilityName: 'projects.list',
      args: {},
      idempotencyKey: 'r-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe('https://api.zeplin.io/v1/projects')
    expect(result.data).toEqual([{ id: 'p1' }, { id: 'p2' }])
  })
})

describe('zeplin components.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/projects/{projectId}/styleguide/components', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse([{ id: 'c1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zeplinConnector.executeRead!({
      source: source(),
      capabilityName: 'components.list',
      args: { projectId: 'proj_a' },
      idempotencyKey: 'r-2',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe(
      'https://api.zeplin.io/v1/projects/proj_a/styleguide/components',
    )
    expect(result.data).toEqual([{ id: 'c1' }])
  })
})
