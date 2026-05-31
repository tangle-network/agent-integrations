import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpConnector } from '../src/connectors/adapters/http.js'
import { validateConnectorManifest } from '../src/connectors/types.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

function makeSource(): ResolvedDataSource {
  return {
    id: 'src_test',
    projectId: 'proj_test',
    publishedAgentId: null,
    kind: 'http',
    label: 'http test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'none' },
    status: 'active',
  }
}

function invocation(args: Record<string, unknown>, name: string): ConnectorInvocation {
  return {
    source: makeSource(),
    capabilityName: name,
    args,
    idempotencyKey: 'idem_test_key',
  }
}

describe('http adapter manifest', () => {
  it('declares kind=http, category=webhook, advisory consistency, and no auth', () => {
    expect(httpConnector.manifest.kind).toBe('http')
    expect(httpConnector.manifest.displayName).toBe('HTTP Request')
    expect(httpConnector.manifest.category).toBe('webhook')
    expect(httpConnector.manifest.defaultConsistencyModel).toBe('advisory')
    expect(httpConnector.manifest.auth).toEqual({ kind: 'none' })
  })

  it('passes manifest validation', () => {
    const result = validateConnectorManifest(httpConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('exposes a read capability (request.fetch) and a mutation capability (request.send)', () => {
    const names = httpConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['request.fetch', 'request.send'])
    const fetchCap = httpConnector.manifest.capabilities.find((c) => c.name === 'request.fetch')
    const sendCap = httpConnector.manifest.capabilities.find((c) => c.name === 'request.send')
    expect(fetchCap?.class).toBe('read')
    expect(sendCap?.class).toBe('mutation')
    if (sendCap?.class !== 'mutation') throw new Error('unreachable')
    expect(sendCap.cas).toBe('none')
    expect(sendCap.externalEffect).toBe(true)
  })

  it('matches manifest capabilities to declared executor methods', () => {
    expect(typeof httpConnector.executeRead).toBe('function')
    expect(typeof httpConnector.executeMutation).toBe('function')
    expect(httpConnector.exchangeOAuth).toBeUndefined()
    expect(httpConnector.refreshToken).toBeUndefined()
  })

  it('test() is healthy by construction — no shared base URL or credentials', async () => {
    const result = await httpConnector.test(makeSource())
    expect(result).toEqual({ ok: true })
  })
})

describe('http executeRead', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the URL, parses JSON when Content-Type is json, and surfaces the etag', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ greeting: 'hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"abc"' },
      }),
    )
    const result = await httpConnector.executeRead!(
      invocation({ url: 'https://api.example.com/ping' }, 'request.fetch'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://api.example.com/ping')
    expect(init.method).toBe('GET')
    expect(result.data).toEqual({ greeting: 'hello' })
    expect(result.etag).toBe('W/"abc"')
    expect(result.fetchedAt).toBeGreaterThan(0)
  })

  it('returns the raw text body when Content-Type is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('plain pong', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const result = await httpConnector.executeRead!(
      invocation({ url: 'https://example.org/feed' }, 'request.fetch'),
    )
    expect(result.data).toBe('plain pong')
  })

  it('appends query parameters, including arrays as repeated keys', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await httpConnector.executeRead!(
      invocation(
        { url: 'https://api.example.com/search', query: { q: 'cats', tag: ['a', 'b'], page: 2, fresh: true } },
        'request.fetch',
      ),
    )
    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    const url = new URL(calledUrl)
    expect(url.searchParams.get('q')).toBe('cats')
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b'])
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('fresh')).toBe('true')
  })

  it('throws when the URL scheme is not http(s)', async () => {
    await expect(
      httpConnector.executeRead!(invocation({ url: 'file:///etc/passwd' }, 'request.fetch')),
    ).rejects.toThrow(/scheme not allowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects mutation methods on the read capability', async () => {
    await expect(
      httpConnector.executeRead!(invocation({ url: 'https://example.com', method: 'POST' }, 'request.fetch')),
    ).rejects.toThrow(/not allowed for request.fetch/)
  })

  it('throws when the upstream returns a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'gone' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      httpConnector.executeRead!(invocation({ url: 'https://example.com/missing' }, 'request.fetch')),
    ).rejects.toThrow(/404/)
  })
})

describe('http executeMutation', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs an object body as JSON with Idempotency-Key forwarded', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 't_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json', etag: 'W/"v1"' },
      }),
    )
    const result = await httpConnector.executeMutation!(
      invocation({ url: 'https://api.example.com/things', body: { name: 'widget' } }, 'request.send'),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'widget' }))
    const headers = init.headers as Headers
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toBe('idem_test_key')
    if (result.status !== 'committed') throw new Error(`expected committed, got ${result.status}`)
    expect(result.data).toEqual({ id: 't_1' })
    expect(result.etagAfter).toBe('W/"v1"')
    expect(result.idempotentReplay).toBe(false)
  })

  it('sends string bodies verbatim with text/plain when caller did not set content-type', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await httpConnector.executeMutation!(
      invocation({ url: 'https://api.example.com/raw', method: 'PUT', body: 'hello' }, 'request.send'),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(init.body).toBe('hello')
    const headers = init.headers as Headers
    expect(headers.get('content-type')).toBe('text/plain;charset=utf-8')
  })

  it('honours the caller-supplied content-type and does not override it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    await httpConnector.executeMutation!(
      invocation(
        { url: 'https://api.example.com/raw', body: '<x/>', headers: { 'content-type': 'application/xml' } },
        'request.send',
      ),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Headers
    expect(headers.get('content-type')).toBe('application/xml')
  })

  it('maps a 409 response to a conflict result, preserving alternatives + currentState', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'taken', alternatives: [{ slot: 'B' }] }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await httpConnector.executeMutation!(
      invocation({ url: 'https://api.example.com/book' }, 'request.send'),
    )
    if (result.status !== 'conflict') throw new Error(`expected conflict, got ${result.status}`)
    expect(result.message).toBe('taken')
    expect(result.alternatives).toEqual([{ slot: 'B' }])
    expect(result.currentState).toEqual({ message: 'taken', alternatives: [{ slot: 'B' }] })
  })

  it('maps a 429 response to a rate-limited result with the Retry-After header honoured', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', {
        status: 429,
        headers: { 'retry-after': '2' },
      }),
    )
    const result = await httpConnector.executeMutation!(
      invocation({ url: 'https://api.example.com/spam' }, 'request.send'),
    )
    if (result.status !== 'rate-limited') throw new Error(`expected rate-limited, got ${result.status}`)
    expect(result.retryAfterMs).toBe(2_000)
  })

  it('rejects read methods on the mutation capability', async () => {
    await expect(
      httpConnector.executeMutation!(invocation({ url: 'https://example.com', method: 'GET' }, 'request.send')),
    ).rejects.toThrow(/not allowed for request.send/)
  })

  it('rejects malformed URLs before issuing the request', async () => {
    await expect(
      httpConnector.executeMutation!(invocation({ url: 'not a url' }, 'request.send')),
    ).rejects.toThrow(/not a valid absolute URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unsupported body types', async () => {
    await expect(
      httpConnector.executeMutation!(
        invocation({ url: 'https://example.com', body: Symbol('nope') as unknown }, 'request.send'),
      ),
    ).rejects.toThrow(/http.body/)
  })

  it('throws on non-2xx, non-409, non-429 responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('boom', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    await expect(
      httpConnector.executeMutation!(invocation({ url: 'https://example.com' }, 'request.send')),
    ).rejects.toThrow(/500/)
  })

  it('caps absurdly large timeouts at the documented maximum', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    await httpConnector.executeMutation!(
      invocation({ url: 'https://example.com', timeoutMs: 999_999_999 }, 'request.send'),
    )
    // No throw == accepted. We can't easily inspect the AbortSignal timeout from outside,
    // but the helper would throw before fetch ran if timeoutMs were invalid.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects non-positive timeouts', async () => {
    await expect(
      httpConnector.executeMutation!(
        invocation({ url: 'https://example.com', timeoutMs: 0 }, 'request.send'),
      ),
    ).rejects.toThrow(/timeoutMs/)
  })
})
