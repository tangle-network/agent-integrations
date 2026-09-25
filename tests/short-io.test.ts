import { afterEach, describe, expect, it, vi } from 'vitest'
import { shortIoConnector } from '../src/connectors/adapters/short-io.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_shortio_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'short-io',
    label: 'short-io test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'short_io_secret' },
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

describe('short-io write-side execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('domains.list GETs /domains (escapes the /api/links base prefix)', async () => {
    let observedUrl = ''
    let observedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      return jsonResponse([{ id: 1, hostname: 'short.example.com' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shortIoConnector.executeRead!({
      source: source(),
      capabilityName: 'domains.list',
      args: {},
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('GET')
    expect(observedUrl).toBe('https://api.short.io/domains')
    const data = result.data as Array<{ hostname: string }>
    expect(data[0].hostname).toBe('short.example.com')
  })

  it('domains.create POSTs /domains with the request body', async () => {
    let observedUrl = ''
    let observedMethod = ''
    let observedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      observedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 42, hostname: 'short.example.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shortIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'domains.create',
      args: { hostname: 'short.example.com', hideReferer: true },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('POST')
    expect(observedUrl).toBe('https://api.short.io/domains')
    expect(observedBody).toMatchObject({ hostname: 'short.example.com', hideReferer: true })
    expect(result.status).toBe('committed')
  })

  it('links.import POSTs /api/links/bulk with {domain, links}', async () => {
    let observedUrl = ''
    let observedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ imported: 2 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shortIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'links.import',
      args: {
        domain: 'short.example.com',
        links: [{ originalURL: 'https://a' }, { originalURL: 'https://b' }],
      },
      idempotencyKey: 'k1',
    })

    expect(observedUrl).toBe('https://api.short.io/api/links/bulk')
    expect(observedBody).toEqual({
      domain: 'short.example.com',
      links: [{ originalURL: 'https://a' }, { originalURL: 'https://b' }],
    })
    expect(result.status).toBe('committed')
  })

  it('targeting.delete DELETEs the country-rule by id', async () => {
    let observedUrl = ''
    let observedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shortIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'targeting.delete',
      args: { linkId: 'lnk_1', ruleId: 'rule_99' },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('DELETE')
    expect(observedUrl).toBe('https://api.short.io/api/links/lnk_1/country-rules/rule_99')
    expect(result.status).toBe('committed')
  })
})
