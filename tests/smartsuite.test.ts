import { afterEach, describe, expect, it, vi } from 'vitest'
import { smartsuiteConnector } from '../src/connectors/adapters/smartsuite.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_smartsuite_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'smartsuite',
    label: 'smartsuite test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'smartsuite_secret' },
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

describe('smartsuite adapter manifest', () => {
  it('classifies itself as the doc category and exposes the smartsuite kind', () => {
    expect(smartsuiteConnector.manifest.kind).toBe('smartsuite')
    expect(smartsuiteConnector.manifest.category).toBe('doc')
    expect(smartsuiteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = smartsuiteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SmartSuite/i)
  })

  it('covers record/file operations plus the new write-side and read capabilities', () => {
    const names = smartsuiteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.upload',
        'records.create',
        'records.delete',
        'records.find',
        'records.get',
        'records.update',
        'records.bulk-create',
        'tables.list',
        'fields.list',
        'comments.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['records.bulk-create', 'comments.create']
    for (const name of expected) {
      const cap = smartsuiteConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('marks the new read capabilities as read', () => {
    const expected = ['tables.list', 'fields.list']
    for (const name of expected) {
      const cap = smartsuiteConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      expect(cap?.class).toBe('read')
    }
  })
})

describe('smartsuite records.bulk-create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/tables/{table}/records/bulk with the items body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ items: [{ id: 'r1' }, { id: 'r2' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartsuiteConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.bulk-create',
      args: { table: 'tbl_1', items: [{ name: 'A' }, { name: 'B' }] },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://app.smartsuite.com/api/v1/tables/tbl_1/records/bulk')
    expect(requestBody).toMatchObject({ items: [{ name: 'A' }, { name: 'B' }] })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      smartsuiteConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.bulk-create',
        args: { table: 'tbl_1', items: [] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('smartsuite comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/tables/{table}/records/{recordId}/comments with the message body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'comment_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsuiteConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: { table: 'tbl_1', recordId: 'rec_1', message: 'looks good' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://app.smartsuite.com/api/v1/tables/tbl_1/records/rec_1/comments')
    expect(requestBody).toMatchObject({ message: 'looks good' })
  })
})

describe('smartsuite tables.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/applications', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 'app_1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartsuiteConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://app.smartsuite.com/api/v1/applications')
    expect(result.data).toEqual([{ id: 'app_1' }])
  })
})

describe('smartsuite fields.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/applications/{table}', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ structure: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsuiteConnector.executeRead!({
      source: source(),
      capabilityName: 'fields.list',
      args: { table: 'tbl_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://app.smartsuite.com/api/v1/applications/tbl_99')
  })
})
