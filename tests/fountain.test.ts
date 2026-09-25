import { afterEach, describe, expect, it, vi } from 'vitest'
import { fountainConnector } from '../src/connectors/adapters/fountain.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_fountain_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'fountain',
    label: 'Fountain test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'fountain-secret' },
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

describe('fountain adapter manifest', () => {
  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = fountainConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('fountain api key')
  })

})

describe('fountain applicants.advance', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /applicants/{id}/advance with the optional stage_id body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'app_1', current_stage_id: 'stage_2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fountainConnector.executeMutation!({
      source: source(),
      capabilityName: 'applicants.advance',
      args: { id: 'app_1', stage_id: 'stage_2' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://api.fountain.com/v2/applicants/app_1/advance')
    expect(requestBody).toMatchObject({ stage_id: 'stage_2' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      fountainConnector.executeMutation!({
        source: source(),
        capabilityName: 'applicants.advance',
        args: { id: 'app_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('fountain applicants.reject', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /applicants/{id}/reject with the rejection_reason in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'app_1', rejected: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fountainConnector.executeMutation!({
      source: source(),
      capabilityName: 'applicants.reject',
      args: {
        id: 'app_1',
        rejection_reason: 'Not a fit',
        send_rejection_email: true,
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.fountain.com/v2/applicants/app_1/reject')
    expect(requestBody).toMatchObject({
      rejection_reason: 'Not a fit',
      send_rejection_email: true,
    })
  })
})
