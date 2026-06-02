import { afterEach, describe, expect, it, vi } from 'vitest'
import { cryptolensConnector } from '../src/connectors/adapters/cryptolens.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cryptolens_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'cryptolens',
    label: 'cryptolens test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'cryptolens_secret' },
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

describe('cryptolens adapter manifest', () => {
  it('classifies itself as the other category and exposes the cryptolens kind', () => {
    expect(cryptolensConnector.manifest.kind).toBe('cryptolens')
    expect(cryptolensConnector.manifest.category).toBe('other')
    expect(cryptolensConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = cryptolensConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers customer + key lifecycle ops (add/block/create) plus activation primitives', () => {
    const names = cryptolensConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['customer.add', 'key.activate', 'key.block', 'key.create', 'key.deactivate'].sort(),
    )
    const mutations = cryptolensConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['customer.add', 'key.activate', 'key.block', 'key.create', 'key.deactivate'].sort(),
    )
  })

  it('marks the new activation mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['key.activate', 'key.deactivate']) {
      const cap = cryptolensConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('cryptolens key.activate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /key/Activate with the token plus product/key/machine in the query string', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ result: 0, licenseKey: 'signed-payload' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await cryptolensConnector.executeMutation!({
      source: source(),
      capabilityName: 'key.activate',
      args: { productId: 1234, key: 'AAAA-BBBB-CCCC-DDDD', machineCode: 'machine-1' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    const url = new URL(String(requestUrl))
    expect(url.pathname).toBe('/api/key/Activate')
    expect(url.searchParams.get('token')).toBe('cryptolens_secret')
    expect(url.searchParams.get('ProductId')).toBe('1234')
    expect(url.searchParams.get('Key')).toBe('AAAA-BBBB-CCCC-DDDD')
    expect(url.searchParams.get('MachineCode')).toBe('machine-1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      cryptolensConnector.executeMutation!({
        source: source(),
        capabilityName: 'key.activate',
        args: { productId: 1, key: 'K', machineCode: 'm' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('cryptolens key.deactivate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /key/Deactivate with product/key/machine arguments', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ result: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await cryptolensConnector.executeMutation!({
      source: source(),
      capabilityName: 'key.deactivate',
      args: { productId: 99, key: 'K-1', machineCode: 'm-1', floating: true },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    const url = new URL(String(requestUrl))
    expect(url.pathname).toBe('/api/key/Deactivate')
    expect(url.searchParams.get('ProductId')).toBe('99')
    expect(url.searchParams.get('Key')).toBe('K-1')
    expect(url.searchParams.get('MachineCode')).toBe('m-1')
    expect(url.searchParams.get('Floating')).toBe('true')
  })
})
