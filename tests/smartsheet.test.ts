import { describe, expect, it } from 'vitest'
import { smartsheetConnector } from '../src/connectors/adapters/smartsheet.js'

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

  it('covers core actions (sheets, rows, attachments)', () => {
    const names = smartsheetConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sheets.search',
        'rows.search',
        'rows.create',
        'rows.update',
        'attachments.create',
        'attachments.search',
      ].sort(),
    )
    const reads = smartsheetConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = smartsheetConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['sheets.search', 'rows.search', 'attachments.search'].sort())
    expect(mutations).toEqual(['rows.create', 'rows.update', 'attachments.create'].sort())
  })
})
