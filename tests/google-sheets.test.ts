import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleSheets,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sheets_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-sheets',
    label: 'Pricing Sheet',
    consistencyModel: 'cache',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    // The new write capabilities take spreadsheetId as a per-call arg, so the
    // source metadata doesn't have to be configured for them. The
    // pre-existing read/update_row paths still rely on readSheetMeta.
    metadata: { spreadsheetId: 'sheet-xyz', sheetName: 'Sheet1', headerRow: 1, keyColumn: 'id' },
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
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

describe('google-sheets adapter — write capabilities', () => {
  const adapter = googleSheets({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes the new write capabilities alongside the existing ones', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'append_row',
      'clear_range',
      'create_sheet',
      'list_rows',
      'query_rows',
      'update_row',
    ])
    const append = adapter.manifest.capabilities.find((c) => c.name === 'append_row')
    expect(append?.class).toBe('mutation')
    if (append && append.class === 'mutation') {
      expect(append.cas).toBe('native-idempotency')
      expect(append.externalEffect).toBe(true)
    }
    expect(append?.parameters?.required).toEqual(['spreadsheetId', 'range', 'values'])

    const clear = adapter.manifest.capabilities.find((c) => c.name === 'clear_range')
    expect(clear?.parameters?.required).toEqual(['spreadsheetId', 'range'])

    const create = adapter.manifest.capabilities.find((c) => c.name === 'create_sheet')
    expect(create?.parameters?.required).toEqual(['title'])
  })

  describe('append_row', () => {
    it('POSTs to values:append with USER_ENTERED + INSERT_ROWS and returns update counts', async () => {
      let appendUrl = ''
      let appendInit: RequestInit | undefined
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        appendUrl = String(input)
        appendInit = init
        return jsonResponse({
          spreadsheetId: 'sheet-xyz',
          tableRange: 'Sheet1!A1:C3',
          updates: {
            updatedRange: 'Sheet1!A4:C4',
            updatedRows: 1,
            updatedColumns: 3,
            updatedCells: 3,
          },
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'append_row',
        args: {
          spreadsheetId: 'sheet-xyz',
          range: 'Sheet1!A1',
          values: [['a', 'b', 'c']],
        },
        idempotencyKey: 'k-append',
      })

      expect(appendUrl).toContain('/spreadsheets/sheet-xyz/values/')
      expect(appendUrl).toContain(':append')
      expect(appendUrl).toContain('valueInputOption=USER_ENTERED')
      expect(appendUrl).toContain('insertDataOption=INSERT_ROWS')
      expect(appendInit?.method).toBe('POST')
      expect(JSON.parse(appendInit!.body as string)).toEqual({ values: [['a', 'b', 'c']] })

      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect(result.data).toMatchObject({
          spreadsheetId: 'sheet-xyz',
          tableRange: 'Sheet1!A1:C3',
          updatedRange: 'Sheet1!A4:C4',
          updatedRows: 1,
          updatedCells: 3,
        })
        expect(result.idempotentReplay).toBe(false)
        expect(typeof result.committedAt).toBe('number')
      }
    })

    it('honors a caller-supplied valueInputOption=RAW', async () => {
      let appendUrl = ''
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        appendUrl = String(input)
        return jsonResponse({ spreadsheetId: 's', updates: {} })
      }))
      await adapter.executeMutation!({
        source: source(),
        capabilityName: 'append_row',
        args: {
          spreadsheetId: 's',
          range: 'Sheet1!A1',
          values: [['x']],
          valueInputOption: 'RAW',
        },
        idempotencyKey: 'k',
      })
      expect(appendUrl).toContain('valueInputOption=RAW')
    })

    it('throws when spreadsheetId / range / values are missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { range: 'Sheet1!A1', values: [['x']] },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets append_row: `spreadsheetId` is required/)
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { spreadsheetId: 's', values: [['x']] },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets append_row: `range` is required/)
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { spreadsheetId: 's', range: 'Sheet1!A1' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets append_row: `values` is required/)
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { spreadsheetId: 's', range: 'Sheet1!A1', values: [] },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets append_row: `values` is required/)
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'unauthorized' }),
        text: async () => 'unauthorized',
      })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { spreadsheetId: 's', range: 'Sheet1!A1', values: [['x']] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })

    it('surfaces ProviderConfigError on a bare 403 (not a reconnect)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'forbidden' }),
        text: async () => 'forbidden',
      })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'append_row',
          args: { spreadsheetId: 's', range: 'Sheet1!A1', values: [['x']] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
    })
  })

  describe('clear_range', () => {
    it('POSTs to values:clear with an empty JSON body and returns clearedRange', async () => {
      let clearUrl = ''
      let clearInit: RequestInit | undefined
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        clearUrl = String(input)
        clearInit = init
        return jsonResponse({
          spreadsheetId: 'sheet-xyz',
          clearedRange: 'Sheet1!A1:C10',
        })
      }))

      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'clear_range',
        args: { spreadsheetId: 'sheet-xyz', range: 'Sheet1!A1:C10' },
        idempotencyKey: 'k-clear',
      })

      expect(clearUrl).toContain('/spreadsheets/sheet-xyz/values/')
      expect(clearUrl).toContain(':clear')
      expect(clearInit?.method).toBe('POST')
      expect(clearInit?.body).toBe('{}')

      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect(result.data).toMatchObject({
          spreadsheetId: 'sheet-xyz',
          clearedRange: 'Sheet1!A1:C10',
        })
        expect(result.idempotentReplay).toBe(false)
      }
    })

    it('throws when spreadsheetId or range is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'clear_range',
          args: { range: 'Sheet1!A1' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets clear_range: `spreadsheetId` is required/)
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'clear_range',
          args: { spreadsheetId: 's' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets clear_range: `range` is required/)
    })

    it('surfaces CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'unauthorized' }),
        text: async () => 'unauthorized',
      })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'clear_range',
          args: { spreadsheetId: 's', range: 'Sheet1!A1' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('create_sheet', () => {
    it('POSTs to /v4/spreadsheets with the configured title and returns the new id', async () => {
      let createUrl = ''
      let createInit: RequestInit | undefined
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        createUrl = String(input)
        createInit = init
        return jsonResponse({
          spreadsheetId: 'new-sheet-1',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-1/edit',
          properties: { title: 'Q3 Forecast' },
        })
      }))

      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_sheet',
        args: { title: 'Q3 Forecast' },
        idempotencyKey: 'k-create',
      })

      expect(createUrl).toBe('https://sheets.googleapis.com/v4/spreadsheets')
      expect(createInit?.method).toBe('POST')
      expect(JSON.parse(createInit!.body as string)).toEqual({
        properties: { title: 'Q3 Forecast' },
      })

      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect(result.data).toMatchObject({
          spreadsheetId: 'new-sheet-1',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-sheet-1/edit',
          title: 'Q3 Forecast',
        })
        expect(result.idempotentReplay).toBe(false)
      }
    })

    it('throws when title is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'create_sheet',
          args: {},
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets create_sheet: `title` is required/)
    })

    it('surfaces ProviderConfigError on a bare 403 (not a reconnect)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'forbidden' }),
        text: async () => 'forbidden',
      })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'create_sheet',
          args: { title: 'T' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
    })

    it('reports the upstream status + trimmed body on other non-OK responses', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'boom' }),
        text: async () => 'boom',
      })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'create_sheet',
          args: { title: 'T' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/google-sheets create_sheet 500: boom/)
    })
  })
})
