import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatebannersConnector } from '../src/connectors/adapters/generatebanners.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_generatebanners_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'generatebanners',
    label: 'GenerateBanners test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'generatebanners_secret' },
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

describe('generatebanners banner.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/banners/{bannerId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generatebannersConnector.executeMutation!({
      source: source(),
      capabilityName: 'banner.delete',
      args: { bannerId: 'banner_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.generatebanners.com/api/v1/banners/banner_99')
    expect(result.status).toBe('committed')
  })
})

describe('generatebanners batch.render', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/templates/{templateId}/batch-render with items in body', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ urls: ['https://cdn.example/1.png', 'https://cdn.example/2.png'] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generatebannersConnector.executeMutation!({
      source: source(),
      capabilityName: 'batch.render',
      args: {
        templateId: 'tpl_1',
        fileType: 'png',
        items: [{ headline: 'A' }, { headline: 'B' }],
      },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain(
      'https://api.generatebanners.com/api/v1/templates/tpl_1/batch-render',
    )
    expect(String(requestUrl)).toContain('fileType=png')
    expect(requestBody).toMatchObject({
      items: [{ headline: 'A' }, { headline: 'B' }],
    })
    expect(result.status).toBe('committed')
  })
})
