import { describe, expect, it } from 'vitest'
import { nocodbConnector } from '../src/connectors/adapters/nocodb.js'

describe('nocodb adapter manifest', () => {
  it('classifies itself as the database category and exposes the nocodb kind', () => {
    expect(nocodbConnector.manifest.kind).toBe('nocodb')
    expect(nocodbConnector.manifest.category).toBe('database')
    expect(nocodbConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = nocodbConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (search, get, create, update, delete)', () => {
    const names = nocodbConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.search',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
      ].sort(),
    )
    const reads = nocodbConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = nocodbConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.get', 'records.search'].sort())
    expect(mutations).toEqual(['records.create', 'records.delete', 'records.update'].sort())
  })
})
