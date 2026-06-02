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

describe('placid adapter manifest', () => {
  it('classifies itself as the storage category and exposes the placid kind', () => {
    expect(placidConnector.manifest.kind).toBe('placid')
    expect(placidConnector.manifest.category).toBe('storage')
    expect(placidConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = placidConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the write-side additions', () => {
    const names = placidConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'images.create',
        'images.get',
        'images.delete',
        'pdfs.create',
        'pdfs.get',
        'pdfs.delete',
        'videos.create',
        'videos.get',
        'videos.delete',
        'files.convert',
        'templates.list',
        'templates.get',
      ].sort(),
    )
    const mutations = placidConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'images.create',
        'images.delete',
        'pdfs.create',
        'pdfs.delete',
        'videos.create',
        'videos.delete',
        'files.convert',
      ].sort(),
    )
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const writeSide = ['images.delete', 'pdfs.delete', 'videos.delete']
    for (const name of writeSide) {
      const cap = placidConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      placidConnector.executeMutation!({
        source: source(),
        capabilityName: 'images.delete',
        args: { imageId: 'img_xyz' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
