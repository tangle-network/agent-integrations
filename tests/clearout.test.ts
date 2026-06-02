import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearoutConnector } from '../src/connectors/adapters/clearout.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clearout_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clearout',
    label: 'Clearout test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'clearout_token' },
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

describe('clearout adapter manifest', () => {
  it('classifies itself as the crm category and exposes the clearout kind', () => {
    expect(clearoutConnector.manifest.kind).toBe('clearout')
    expect(clearoutConnector.manifest.category).toBe('crm')
    expect(clearoutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = clearoutConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers instant + bulk lifecycle', () => {
    const names = clearoutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['bulk.verify.cancel', 'bulk.verify.start', 'instant.verify'])
    const mutations = clearoutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['bulk.verify.cancel', 'bulk.verify.start', 'instant.verify'])
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of clearoutConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('clearout bulk.verify.start', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/email_verify/bulk with list_id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'success', data: { list_id: 'list_abc' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clearoutConnector.executeMutation!({
      source: source(),
      capabilityName: 'bulk.verify.start',
      args: { list_id: 'list_abc' },
      idempotencyKey: 'bulk-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clearout.io/v2/email_verify/bulk')
    expect(capturedBody).toMatchObject({ list_id: 'list_abc' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      clearoutConnector.executeMutation!({
        source: source(),
        capabilityName: 'bulk.verify.start',
        args: { list_id: 'list_abc' },
        idempotencyKey: 'bulk-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('clearout bulk.verify.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/email_verify/bulk/cancel with list_id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'success' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clearoutConnector.executeMutation!({
      source: source(),
      capabilityName: 'bulk.verify.cancel',
      args: { list_id: 'list_abc' },
      idempotencyKey: 'cancel-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clearout.io/v2/email_verify/bulk/cancel')
    expect(capturedBody).toMatchObject({ list_id: 'list_abc' })
    expect(result.status).toBe('committed')
  })
})
