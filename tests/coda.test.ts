import { describe, expect, it } from 'vitest'
import { codaConnector } from '../src/connectors/adapters/coda.js'

describe('coda adapter manifest', () => {
  it('classifies itself as the spreadsheet category and exposes the coda kind', () => {
    expect(codaConnector.manifest.kind).toBe('coda')
    expect(codaConnector.manifest.displayName).toBe('Coda')
    expect(codaConnector.manifest.category).toBe('spreadsheet')
    expect(codaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth (Coda issues long-lived bearer tokens, not OAuth)', () => {
    const auth = codaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers docs discovery, table introspection, row CRUD, formulas, buttons, and pages', () => {
    const names = codaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.whoami',
        'docs.list',
        'docs.get',
        'pages.list',
        'pages.create',
        'tables.list',
        'tables.get',
        'columns.list',
        'rows.list',
        'rows.get',
        'rows.upsert',
        'rows.update',
        'rows.delete',
        'rows.pushButton',
        'formulas.get',
      ].sort(),
    )

    const reads = codaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = codaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'account.whoami',
        'columns.list',
        'docs.get',
        'docs.list',
        'formulas.get',
        'pages.list',
        'rows.get',
        'rows.list',
        'tables.get',
        'tables.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['pages.create', 'rows.delete', 'rows.pushButton', 'rows.update', 'rows.upsert'].sort(),
    )
  })

  it('uses optimistic-read-verify CAS for in-place row updates and native-idempotency for inserts/deletes', () => {
    const byName = new Map(codaConnector.manifest.capabilities.map((c) => [c.name, c]))
    const rowsUpdate = byName.get('rows.update')
    const rowsUpsert = byName.get('rows.upsert')
    const rowsDelete = byName.get('rows.delete')
    if (rowsUpdate?.class !== 'mutation') throw new Error('rows.update should be a mutation')
    if (rowsUpsert?.class !== 'mutation') throw new Error('rows.upsert should be a mutation')
    if (rowsDelete?.class !== 'mutation') throw new Error('rows.delete should be a mutation')
    expect(rowsUpdate.cas).toBe('optimistic-read-verify')
    expect(rowsUpsert.cas).toBe('native-idempotency')
    expect(rowsDelete.cas).toBe('native-idempotency')
  })
})
