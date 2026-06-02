import { afterEach, describe, expect, it, vi } from 'vitest'
import { bannerbearConnector } from '../src/connectors/adapters/bannerbear.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bb_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bannerbear',
    label: 'Bannerbear test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bb_secret' },
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

describe('bannerbear adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bannerbear kind', () => {
    expect(bannerbearConnector.manifest.kind).toBe('bannerbear')
    expect(bannerbearConnector.manifest.category).toBe('crm')
    expect(bannerbearConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = bannerbearConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: image create + image delete + video + collection', () => {
    const names = bannerbearConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['collections.create', 'images.create', 'images.delete', 'videos.create'].sort(),
    )
    const mutations = bannerbearConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['collections.create', 'images.create', 'images.delete', 'videos.create'].sort(),
    )
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const writeSide = ['images.delete', 'videos.create', 'collections.create']
    for (const name of writeSide) {
      const cap = bannerbearConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('bannerbear images.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/images/{imageId}', async () => {
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
    const result = await bannerbearConnector.executeMutation!({
      source: source(),
      capabilityName: 'images.delete',
      args: { imageId: 'img_xyz' },
      idempotencyKey: 'idemp-del-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.bannerbear.com/v2/images/img_xyz')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bannerbearConnector.executeMutation!({
        source: source(),
        capabilityName: 'images.delete',
        args: { imageId: 'img_xyz' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('bannerbear videos.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the template + modifications to /v2/videos', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ uid: 'vid_1', status: 'pending' })
      }),
    )
    const modifications = [{ name: 'title', text: 'Q1 Highlights' }]
    const result = await bannerbearConnector.executeMutation!({
      source: source(),
      capabilityName: 'videos.create',
      args: { video_template: 'vtmpl_1', modifications },
      idempotencyKey: 'idemp-vid-1',
    })
    expect(capturedUrl).toBe('https://api.bannerbear.com/v2/videos')
    expect(capturedBody).toMatchObject({
      video_template: 'vtmpl_1',
      modifications,
    })
    expect(result.status).toBe('committed')
  })
})

describe('bannerbear collections.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the template_set id + modifications to /v2/collections', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ uid: 'col_1', status: 'pending' })
      }),
    )
    const modifications = [{ name: 'headline', text: 'Launch Week' }]
    const result = await bannerbearConnector.executeMutation!({
      source: source(),
      capabilityName: 'collections.create',
      args: { template_set: 'tset_1', modifications, transparent: true },
      idempotencyKey: 'idemp-col-1',
    })
    expect(capturedUrl).toBe('https://api.bannerbear.com/v2/collections')
    expect(capturedBody).toMatchObject({
      template_set: 'tset_1',
      modifications,
      transparent: true,
    })
    expect(result.status).toBe('committed')
  })
})
