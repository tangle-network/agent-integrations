import { afterEach, describe, expect, it, vi } from 'vitest'
import { instaChartsConnector } from '../src/connectors/adapters/insta-charts.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_insta_charts_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'insta-charts',
    label: 'insta-charts test',
    consistencyModel: 'authoritative',
    scopes: ['chart.create', 'chart.read'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
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

describe('insta-charts chart.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/chart/{chartId} with the update payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'chart_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await instaChartsConnector.executeMutation!({
      source: source(),
      capabilityName: 'chart.update',
      args: { chartId: 'chart_42', title: 'Renamed' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.instacharts.com/v1/chart/chart_42')
    expect(requestBody).toMatchObject({ title: 'Renamed' })
  })
})

describe('insta-charts chart.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/chart/{chartId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await instaChartsConnector.executeMutation!({
      source: source(),
      capabilityName: 'chart.delete',
      args: { chartId: 'chart_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.instacharts.com/v1/chart/chart_99')
  })
})
