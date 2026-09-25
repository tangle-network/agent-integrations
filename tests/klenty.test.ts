import { afterEach, describe, expect, it, vi } from 'vitest'
import { klentyConnector } from '../src/connectors/adapters/klenty.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_klenty_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'klenty',
    label: 'Klenty test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'klenty_secret' },
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

describe('klenty prospect.remove.from.campaign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /apis/v1/user/{username}/stopCadence with email + cadenceName body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'removed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await klentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'prospect.remove.from.campaign',
      args: {
        username: 'rep@acme.com',
        email: 'lead@example.com',
        cadenceName: 'Q1 outbound',
      },
      idempotencyKey: 'idemp-remove-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/apis/v1/user/rep%40acme.com/stopCadence')
    expect(requestBody).toMatchObject({ email: 'lead@example.com', cadenceName: 'Q1 outbound' })
    expect(result.status).toBe('committed')
  })
})

describe('klenty cadence.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /apis/v1/user/{username}/pauseCadence with email + cadenceName body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'paused' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await klentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'cadence.pause',
      args: {
        username: 'rep@acme.com',
        email: 'lead@example.com',
        cadenceName: 'Q1 outbound',
      },
      idempotencyKey: 'idemp-pause-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/apis/v1/user/rep%40acme.com/pauseCadence')
    expect(requestBody).toMatchObject({ email: 'lead@example.com', cadenceName: 'Q1 outbound' })
    expect(result.status).toBe('committed')
  })
})
