import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearoutphoneConnector } from '../src/connectors/adapters/clearoutphone.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clearoutphone_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clearoutphone',
    label: 'ClearoutPhone test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'clearoutphone_token' },
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

describe('clearoutphone adapter manifest', () => {
  it('classifies itself as the comms category and exposes the clearoutphone kind', () => {
    expect(clearoutphoneConnector.manifest.kind).toBe('clearoutphone')
    expect(clearoutphoneConnector.manifest.category).toBe('comms')
    expect(clearoutphoneConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = clearoutphoneConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers find/validate + bulk lifecycle', () => {
    const names = clearoutphoneConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'bulk.verify.cancel',
        'bulk.verify.start',
        'find.phone.number.carrier',
        'find.phone.number.is.mobile',
        'validate.phone.number',
      ].sort(),
    )
    const mutations = clearoutphoneConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['bulk.verify.cancel', 'bulk.verify.start', 'validate.phone.number'])
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of clearoutphoneConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('clearoutphone bulk.verify.start', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/phonenumber/bulk with list_id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'success', data: { list_id: 'pl_abc' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clearoutphoneConnector.executeMutation!({
      source: source(),
      capabilityName: 'bulk.verify.start',
      args: { list_id: 'pl_abc' },
      idempotencyKey: 'bulk-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clearoutphone.com/v1/phonenumber/bulk')
    expect(capturedBody).toMatchObject({ list_id: 'pl_abc' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      clearoutphoneConnector.executeMutation!({
        source: source(),
        capabilityName: 'bulk.verify.start',
        args: { list_id: 'pl_abc' },
        idempotencyKey: 'bulk-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('clearoutphone bulk.verify.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/phonenumber/bulk/cancel with list_id', async () => {
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

    const result = await clearoutphoneConnector.executeMutation!({
      source: source(),
      capabilityName: 'bulk.verify.cancel',
      args: { list_id: 'pl_abc' },
      idempotencyKey: 'cancel-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clearoutphone.com/v1/phonenumber/bulk/cancel')
    expect(capturedBody).toMatchObject({ list_id: 'pl_abc' })
    expect(result.status).toBe('committed')
  })
})
