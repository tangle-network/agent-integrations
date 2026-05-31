import { describe, expect, it } from 'vitest'
import { vtigerConnector } from '../src/connectors/adapters/vtiger.js'

describe('vtiger adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vtiger kind', () => {
    expect(vtigerConnector.manifest.kind).toBe('vtiger')
    expect(vtigerConnector.manifest.category).toBe('crm')
    expect(vtigerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = vtigerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (search, get, create, update, delete, query)', () => {
    const names = vtigerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.search',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
        'records.query',
      ].sort(),
    )
    const reads = vtigerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = vtigerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.get', 'records.query', 'records.search'].sort())
    expect(mutations).toEqual(['records.create', 'records.delete', 'records.update'].sort())
  })
})
