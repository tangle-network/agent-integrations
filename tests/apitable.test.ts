import { afterEach, describe, expect, it, vi } from 'vitest'
import { apitableConnector } from '../src/connectors/adapters/apitable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_apitable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'apitable',
    label: 'apitable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'apitable_secret' },
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

describe('apitable adapter manifest', () => {
  it('classifies itself as the spreadsheet category and exposes the apitable kind', () => {
    expect(apitableConnector.manifest.kind).toBe('apitable')
    expect(apitableConnector.manifest.category).toBe('spreadsheet')
    expect(apitableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = apitableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the record, field, and datasheet lifecycle', () => {
    const names = apitableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'datasheets.create',
      'fields.create',
      'records.create',
      'records.delete',
      'records.find',
      'records.update',
    ])

    const reads = apitableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = apitableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.find'])
    expect(mutations).toEqual([
      'datasheets.create',
      'fields.create',
      'records.create',
      'records.delete',
      'records.update',
    ])
  })

  it('marks the new write mutations as native-idempotency external-effect', () => {
    for (const name of ['records.delete', 'fields.create', 'datasheets.create']) {
      const cap = apitableConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('apitable records.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /fusion/v1/datasheets/{datasheetId}/records with recordIds in the query', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apitableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.delete',
      args: { datasheetId: 'dst1', recordIds: ['rec1', 'rec2'] },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toContain('https://aitable.ai/fusion/v1/datasheets/dst1/records')
    expect(requestUrl).toContain('recordIds=')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      apitableConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.delete',
        args: { datasheetId: 'dst1', recordIds: ['rec1'] },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('apitable fields.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /fusion/v1/datasheets/{datasheetId}/fields with the field payload', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { id: 'fld_new' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apitableConnector.executeMutation!({
      source: source(),
      capabilityName: 'fields.create',
      args: { datasheetId: 'dst1', name: 'priority', type: 'SingleText' },
      idempotencyKey: 'k-field',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://aitable.ai/fusion/v1/datasheets/dst1/fields')
    expect(requestBody).toMatchObject({ name: 'priority', type: 'SingleText' })
    expect(result.status).toBe('committed')
  })
})

describe('apitable datasheets.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /fusion/v1/spaces/{spaceId}/datasheets with the name payload', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { id: 'dst_new', name: 'Leads' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apitableConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasheets.create',
      args: { spaceId: 'spc1', name: 'Leads' },
      idempotencyKey: 'k-ds',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://aitable.ai/fusion/v1/spaces/spc1/datasheets')
    expect(requestBody).toMatchObject({ spaceId: 'spc1', name: 'Leads' })
    expect(result.status).toBe('committed')
  })
})
