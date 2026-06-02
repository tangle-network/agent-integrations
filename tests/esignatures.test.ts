import { afterEach, describe, expect, it, vi } from 'vitest'
import { esignaturesConnector } from '../src/connectors/adapters/esignatures.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_esignatures_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'esignatures',
    label: 'eSignatures test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'esig_secret' },
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

describe('esignatures adapter manifest', () => {
  it('classifies itself as the crm category and exposes the esignatures kind', () => {
    expect(esignaturesConnector.manifest.kind).toBe('esignatures')
    expect(esignaturesConnector.manifest.category).toBe('crm')
    expect(esignaturesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = esignaturesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the action set (create, cancel, delete)', () => {
    const names = esignaturesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.contract', 'contract.cancel', 'contract.delete'].sort())
    const mutations = esignaturesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['create.contract', 'contract.cancel', 'contract.delete'].sort())
  })

  it('marks every mutation as native-idempotency externalEffect', () => {
    const caps = esignaturesConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('esignatures contract.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /contracts/{contractId}/withdraw', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'withdrawn' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await esignaturesConnector.executeMutation!({
      source: source(),
      capabilityName: 'contract.cancel',
      args: { contractId: 'ctr_1', voidedBy: 'Drew' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe(
      'https://esignatures.io/api/contracts/ctr_1/withdraw',
    )
    expect(requestBody).toEqual({ voided_by: 'Drew' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      esignaturesConnector.executeMutation!({
        source: source(),
        capabilityName: 'contract.cancel',
        args: { contractId: 'ctr_1', voidedBy: 'Drew' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('esignatures contract.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /contracts/{contractId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await esignaturesConnector.executeMutation!({
      source: source(),
      capabilityName: 'contract.delete',
      args: { contractId: 'ctr_1' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://esignatures.io/api/contracts/ctr_1')
  })
})
