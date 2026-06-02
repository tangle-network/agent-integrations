import { afterEach, describe, expect, it, vi } from 'vitest'
import { textcortexAiConnector } from '../src/connectors/adapters/textcortex-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_textcortex_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'textcortex-ai',
    label: 'textcortex-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'textcortex_secret' },
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

describe('textcortex-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the textcortex-ai kind', () => {
    expect(textcortexAiConnector.manifest.kind).toBe('textcortex-ai')
    expect(textcortexAiConnector.manifest.category).toBe('comms')
    expect(textcortexAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = textcortexAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/TextCortex/i)
  })

  it('covers original generation capabilities plus templates, personas, and history surface', () => {
    const names = textcortexAiConnector.manifest.capabilities.map((c) => c.name).sort()
    const expected = [
      'code.create',
      'email.create',
      'history.delete',
      'history.list',
      'paraphrase.create',
      'personas.list',
      'product.description.create',
      'prompt.send',
      'social.media.caption.create',
      'summary.create',
      'templates.list',
      'translation.create',
    ].sort()
    expect(names).toEqual(expected)
  })

  it('classifies templates/personas/history list as reads and history.delete as mutation', () => {
    const reads = textcortexAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['history.list', 'personas.list', 'templates.list'])

    const mutations = textcortexAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('history.delete')
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of textcortexAiConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('textcortex-ai history.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/history', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await textcortexAiConnector.executeRead!({
      source: source(),
      capabilityName: 'history.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('https://api.textcortex.com/v1/history')
    expect(result.data).toEqual({ data: [] })
  })
})

describe('textcortex-ai history.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/history/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await textcortexAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'history.delete',
      args: { id: 'hist_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.textcortex.com/v1/history/hist_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      textcortexAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'history.delete',
        args: { id: 'hist_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('textcortex-ai templates.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/templates', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await textcortexAiConnector.executeRead!({
      source: source(),
      capabilityName: 'templates.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('https://api.textcortex.com/v1/templates')
  })
})

describe('textcortex-ai personas.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/personas', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await textcortexAiConnector.executeRead!({
      source: source(),
      capabilityName: 'personas.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('https://api.textcortex.com/v1/personas')
  })
})
