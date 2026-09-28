import { afterEach, describe, expect, it, vi } from 'vitest'
import { placidConnector } from '../src/connectors/adapters/placid.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_placid_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'placid',
    label: 'Placid test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'placid_secret' },
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

describe('placid images.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/rest/v1/images/{imageId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await placidConnector.executeMutation!({
      source: source(),
      capabilityName: 'images.delete',
      args: { imageId: 'img_xyz' },
      idempotencyKey: 'idemp-imgdel-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.placid.app/api/rest/v1/images/img_xyz')
    expect(result.status).toBe('committed')
  })
})

describe('placid pdfs.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/rest/v1/pdfs/{pdfId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await placidConnector.executeMutation!({
      source: source(),
      capabilityName: 'pdfs.delete',
      args: { pdfId: 'pdf_abc' },
      idempotencyKey: 'idemp-pdfdel-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.placid.app/api/rest/v1/pdfs/pdf_abc')
    expect(result.status).toBe('committed')
  })
})

describe('placid videos.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/rest/v1/videos/{videoId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await placidConnector.executeMutation!({
      source: source(),
      capabilityName: 'videos.delete',
      args: { videoId: 'vid_zzz' },
      idempotencyKey: 'idemp-viddel-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.placid.app/api/rest/v1/videos/vid_zzz')
    expect(result.status).toBe('committed')
  })
})

describe('placid templates.get', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/rest/v1/templates/{templateId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ id: 'tpl_1', title: 'Hero card' })
      }),
    )
    const result = await placidConnector.executeRead!({
      source: source(),
      capabilityName: 'templates.get',
      args: { templateId: 'tpl_1' },
      idempotencyKey: 'k-read-1',
    })
    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe('https://api.placid.app/api/rest/v1/templates/tpl_1')
    expect((result.data as { id: string }).id).toBe('tpl_1')
  })
})
