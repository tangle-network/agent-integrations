import { afterEach, describe, expect, it, vi } from 'vitest'
import { chartlyConnector } from '../src/connectors/adapters/chartly.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chartly_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chartly',
    label: 'Chartly test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'chartly-secret' },
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

describe('chartly adapter manifest', () => {
  it('exposes the chartly kind and the other category (chartly is workflow tooling in activepieces)', () => {
    expect(chartlyConnector.manifest.kind).toBe('chartly')
    expect(chartlyConnector.manifest.category).toBe('other')
    expect(chartlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chartlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers create + get plus the new update / delete / share writes', () => {
    const names = chartlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['create.chart', 'delete.chart', 'get.chart', 'share.chart', 'update.chart'].sort(),
    )
    const reads = chartlyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chartlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.chart'])
    expect(mutations).toEqual(
      ['create.chart', 'delete.chart', 'share.chart', 'update.chart'].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of chartlyConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('chartly update.chart', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /charts/{chart_id} with the new chart payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'ch_1', updated: true })
      }),
    )
    const result = await chartlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'update.chart',
      args: {
        chart_id: 'ch_1',
        chart_type: 'bar',
        chart_title: 'Q2 Revenue',
        labels: ['Apr', 'May', 'Jun'],
        dataset_label: 'Revenue',
        data_values: [100, 200, 300],
        background_color: '#4285F4',
        width: 800,
        height: 400,
        format: 'png',
        background_color_image: '#ffffff',
        advanced_config: { responsive: true },
      },
      idempotencyKey: 'k-update-1',
    })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://api.chartly.dev/v1/charts/ch_1')
    expect(capturedBody).toMatchObject({
      chart_type: 'bar',
      chart_title: 'Q2 Revenue',
      labels: ['Apr', 'May', 'Jun'],
      dataset_label: 'Revenue',
      data_values: [100, 200, 300],
      width: 800,
      height: 400,
      format: 'png',
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      chartlyConnector.executeMutation!({
        source: source(),
        capabilityName: 'update.chart',
        args: {
          chart_id: 'ch_1',
          chart_type: 'bar',
          chart_title: 't',
          labels: ['a'],
          dataset_label: 'd',
          data_values: [1],
          background_color: '#000',
          width: 100,
          height: 100,
          format: 'png',
          background_color_image: '#fff',
          advanced_config: {},
        },
        idempotencyKey: 'k-update-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chartly delete.chart', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /charts/{chart_id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ deleted: true })
      }),
    )
    const result = await chartlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'delete.chart',
      args: { chart_id: 'ch_1' },
      idempotencyKey: 'k-delete-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.chartly.dev/v1/charts/ch_1')
    expect(result.status).toBe('committed')
  })
})

describe('chartly share.chart', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /charts/{chart_id}/share with recipient and permission', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ shareLink: 'https://chartly.dev/s/abc' })
      }),
    )
    const result = await chartlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'share.chart',
      args: {
        chart_id: 'ch_1',
        recipient: 'drew@example.com',
        permission: 'view',
        message: 'Take a look',
      },
      idempotencyKey: 'k-share-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.chartly.dev/v1/charts/ch_1/share')
    expect(capturedBody).toEqual({
      recipient: 'drew@example.com',
      permission: 'view',
      message: 'Take a look',
    })
    expect(result.status).toBe('committed')
  })
})
