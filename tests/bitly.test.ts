import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitlyConnector } from '../src/connectors/adapters/bitly.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bitly_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bitly',
    label: 'Bitly test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bitly_token' },
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

describe('bitly adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bitly kind', () => {
    expect(bitlyConnector.manifest.kind).toBe('bitly')
    expect(bitlyConnector.manifest.category).toBe('crm')
    expect(bitlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (Bitly access token, sent as Bearer)', () => {
    const auth = bitlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the extended catalog action set including the new deletes/updates', () => {
    const names = bitlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'bitlink.archive',
        'bitlink.create',
        'bitlink.delete',
        'bitlink.get',
        'bitlink.update',
        'group.update',
        'qr.create',
        'qr.delete',
      ].sort(),
    )
    const mutations = bitlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'bitlink.archive',
        'bitlink.create',
        'bitlink.delete',
        'bitlink.update',
        'group.update',
        'qr.create',
        'qr.delete',
      ].sort(),
    )
  })

  it('marks every new mutation as native-idempotency external effect', () => {
    const newMutations = new Set(['bitlink.delete', 'group.update', 'qr.delete'])
    for (const c of bitlyConnector.manifest.capabilities) {
      if (!newMutations.has(c.name)) continue
      expect(c.class).toBe('mutation')
      if (c.class !== 'mutation') throw new Error('unreachable')
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('bitly adapter write execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes bitlink.delete with archived: true', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ archived: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bitlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'bitlink.delete',
      args: { bitlink: 'bit.ly/abc' },
      idempotencyKey: 'idem_del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    // bitlink contains a `/` — interpolate URL-encodes it
    expect(requestUrl).toBe('https://api-ssl.bitly.com/v4/bitlinks/bit.ly%2Fabc')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({ archived: true })
  })

  it('PATCHes group.update with the renamed body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ guid: 'g_1', name: 'Pro' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bitlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'group.update',
      args: { group_guid: 'g_1', name: 'Pro' },
      idempotencyKey: 'idem_g',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api-ssl.bitly.com/v4/groups/g_1')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({ name: 'Pro' })
  })

  it('DELETEs a qr code at the v4 path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bitlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'qr.delete',
      args: { qrcode_id: 'qr_42' },
      idempotencyKey: 'idem_qr',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api-ssl.bitly.com/v4/qr-codes/qr_42')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bitlyConnector.executeMutation!({
        source: source(),
        capabilityName: 'qr.delete',
        args: { qrcode_id: 'qr_x' },
        idempotencyKey: 'idem_x',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
