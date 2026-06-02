import { afterEach, describe, expect, it, vi } from 'vitest'
import { kudosityConnector } from '../src/connectors/adapters/kudosity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_kudosity_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'kudosity',
    label: 'kudosity test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'kudosity_secret' },
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

describe('kudosity adapter manifest', () => {
  it('classifies itself as the comms category and exposes the kudosity kind', () => {
    expect(kudosityConnector.manifest.kind).toBe('kudosity')
    expect(kudosityConnector.manifest.category).toBe('comms')
    expect(kudosityConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = kudosityConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts + SMS lifecycle + number format)', () => {
    const names = kudosityConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contact.add.update',
        'contact.create',
        'contact.update',
        'contact.delete',
        'sms.send',
        'sms.cancel',
        'sms.info.get',
        'number.format',
      ].sort(),
    )
    const reads = kudosityConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kudosityConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['number.format', 'sms.info.get'].sort())
    expect(mutations).toEqual(
      [
        'contact.add.update',
        'contact.create',
        'contact.update',
        'contact.delete',
        'sms.cancel',
        'sms.send',
      ].sort(),
    )
  })

  it('marks all mutations as native-idempotency external effects', () => {
    for (const c of kudosityConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('kudosity contact.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the contact to the add-to-list endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 12345, msisdn: '+15551112222' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kudosityConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.create',
      args: {
        listId: '987',
        msisdn: '+15551112222',
        email: 'alice@example.com',
        firstName: 'Alice',
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('api.transmitsms.com/add-to-list.json')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody as string) as Record<string, unknown>
    expect(parsed.list_id).toBe('987')
    expect(parsed.msisdn).toBe('+15551112222')
    expect(parsed.email).toBe('alice@example.com')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      kudosityConnector.executeMutation!({
        source: source(),
        capabilityName: 'contact.create',
        args: { listId: '1', msisdn: '+15550000000', email: 'a@b.co' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('kudosity contact.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the update through the upsert endpoint', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kudosityConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.update',
      args: { listId: '1', msisdn: '+15551112222', firstName: 'Bob' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/add-to-list.json')
  })
})
