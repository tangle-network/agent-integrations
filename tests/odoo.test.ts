import { describe, expect, it } from 'vitest'
import { odooConnector } from '../src/connectors/adapters/odoo.js'

describe('odoo adapter manifest', () => {
  it('classifies itself as the crm category and exposes the odoo kind', () => {
    expect(odooConnector.manifest.kind).toBe('odoo')
    expect(odooConnector.manifest.category).toBe('crm')
    expect(odooConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = odooConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes core record operations: search, read, create, update, delete, count', () => {
    const names = odooConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('records.search_read')
    expect(names).toContain('records.get')
    expect(names).toContain('records.create')
    expect(names).toContain('records.update')
    expect(names).toContain('records.delete')
    expect(names).toContain('models.search')
    expect(names).toContain('models.count')
  })

  it('marks create, update, and delete as mutations', () => {
    const mutations = odooConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['records.create', 'records.delete', 'records.update'].sort())
  })

  it('marks read operations as read-only', () => {
    const reads = odooConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('records.search_read')
    expect(reads).toContain('records.get')
    expect(reads).toContain('models.search')
    expect(reads).toContain('models.count')
  })
})
