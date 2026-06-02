import { afterEach, describe, expect, it, vi } from 'vitest'
import { smartsheetConnector } from '../src/connectors/adapters/smartsheet.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_smartsheet_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'smartsheet',
    label: 'smartsheet test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'smartsheet_secret' },
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

describe('smartsheet adapter manifest', () => {
  it('classifies itself as the doc category and exposes the smartsheet kind', () => {
    expect(smartsheetConnector.manifest.kind).toBe('smartsheet')
    expect(smartsheetConnector.manifest.category).toBe('doc')
    expect(smartsheetConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = smartsheetConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the new write-side mutations', () => {
    const names = smartsheetConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sheets.search',
        'sheets.create',
        'rows.search',
        'rows.create',
        'rows.update',
        'rows.delete',
        'attachments.create',
        'attachments.search',
        'attachments.delete',
        'shares.create',
        'comments.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = [
      'sheets.create',
      'rows.delete',
      'attachments.delete',
      'shares.create',
      'comments.create',
    ]
    for (const name of expected) {
      const cap = smartsheetConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('smartsheet sheets.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /2.0/sheets with name and columns', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ result: { id: 'sheet_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smartsheetConnector.executeMutation!({
      source: source(),
      capabilityName: 'sheets.create',
      args: { name: 'New Sheet', columns: [{ title: 'Col1', type: 'TEXT_NUMBER' }] },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.smartsheet.com/2.0/sheets')
    expect(requestBody).toMatchObject({ name: 'New Sheet' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      smartsheetConnector.executeMutation!({
        source: source(),
        capabilityName: 'sheets.create',
        args: { name: 'x', columns: [] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('smartsheet rows.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /2.0/sheets/{sheetId}/rows with ids query', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ message: 'SUCCESS' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsheetConnector.executeMutation!({
      source: source(),
      capabilityName: 'rows.delete',
      args: { sheetId: 'sheet_42', ids: '1,2,3' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/2.0/sheets/sheet_42/rows')
    expect(String(requestUrl)).toContain('ids=1%2C2%2C3')
  })
})

describe('smartsheet attachments.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /2.0/sheets/{sheetId}/attachments/{attachmentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ message: 'SUCCESS' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsheetConnector.executeMutation!({
      source: source(),
      capabilityName: 'attachments.delete',
      args: { sheetId: 'sheet_7', attachmentId: 'att_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.smartsheet.com/2.0/sheets/sheet_7/attachments/att_9')
  })
})

describe('smartsheet shares.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /2.0/sheets/{sheetId}/shares with the share body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ result: { id: 'share_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsheetConnector.executeMutation!({
      source: source(),
      capabilityName: 'shares.create',
      args: { sheetId: 'sheet_1', email: 'a@b.com', accessLevel: 'EDITOR' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://api.smartsheet.com/2.0/sheets/sheet_1/shares')
    expect(requestBody).toMatchObject({ email: 'a@b.com', accessLevel: 'EDITOR' })
  })
})

describe('smartsheet comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /2.0/sheets/{sheetId}/rows/{rowId}/discussions with the comment body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ result: { id: 'disc_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smartsheetConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: { sheetId: 'sheet_1', rowId: 'row_1', text: 'hello' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://api.smartsheet.com/2.0/sheets/sheet_1/rows/row_1/discussions')
    expect(requestBody).toMatchObject({ comment: { text: 'hello' } })
  })
})
