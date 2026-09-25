import { afterEach, describe, expect, it, vi } from 'vitest'
import { flipandoConnector } from '../src/connectors/adapters/flipando.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_flipando_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'flipando',
    label: 'Flipando test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'flip_secret' },
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

describe('flipando adapter manifest', () => {
  it('declares an api-key auth surface (Flipando has no OAuth flow)', () => {
    const auth = flipandoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Flipando/i)
  })

})

describe('flipando tasks.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v2/tasks/{id}/cancel and commits', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'tsk-1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await flipandoConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.cancel',
      args: { task_id: 'tsk-1' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v2/tasks/tsk-1/cancel')
    expect(result.status).toBe('committed')
  })

  it('rejects when required task_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      flipandoConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.cancel',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: task_id/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      flipandoConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.cancel',
        args: { task_id: 'tsk-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
