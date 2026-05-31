import { describe, expect, it } from 'vitest'
import { microsoftExcel365Connector } from '../src/connectors/adapters/microsoft-excel-365.js'

describe('microsoft-excel-365 adapter manifest', () => {
  it('classifies itself as the spreadsheet category and exposes the microsoft-excel-365 kind', () => {
    expect(microsoftExcel365Connector.manifest.kind).toBe('microsoft-excel-365')
    expect(microsoftExcel365Connector.manifest.category).toBe('spreadsheet')
    expect(microsoftExcel365Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth against the Microsoft identity platform v2.0 endpoints', () => {
    const auth = microsoftExcel365Connector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.authorizationUrl).toBe(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      )
      expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
      expect(auth.scopes).toContain('offline_access')
      expect(auth.scopes).toContain('Files.ReadWrite')
    }
  })

  it('exposes the full activepieces excel action set (workbooks, worksheets, tables, ranges, rows)', () => {
    const names = microsoftExcel365Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'add.worksheet',
        'append.multiple.rows',
        'append.row',
        'append.table.rows',
        'clear.column',
        'clear.range',
        'clear.row',
        'clear.worksheet',
        'convert.to.range',
        'create.table',
        'create.workbook',
        'create.worksheet',
        'delete.row',
        'delete.table',
        'delete.workbook',
        'delete.worksheet',
        'find.row',
        'find.workbook',
        'find.worksheet',
        'get.range',
        'get.row',
        'get.table.columns',
        'get.table.rows',
        'get.workbooks',
        'get.worksheet',
        'get.worksheet.columns',
        'get.worksheet.rows',
        'get.worksheets',
        'lookup.table.column',
        'rename.worksheet',
        'update.row',
      ].sort(),
    )
  })
})
