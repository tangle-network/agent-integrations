import { describe, expect, it } from 'vitest'
import { oracleDatabaseConnector } from '../src/connectors/adapters/oracle-database.js'

describe('oracle-database adapter manifest', () => {
  it('classifies itself as the database category and exposes the oracle-database kind', () => {
    expect(oracleDatabaseConnector.manifest.kind).toBe('oracle-database')
    expect(oracleDatabaseConnector.manifest.category).toBe('database')
    expect(oracleDatabaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = oracleDatabaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (rows and sql operations)', () => {
    const names = oracleDatabaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['rows.find', 'rows.insert', 'rows.insertBatch', 'rows.update', 'rows.delete', 'sql.execute'].sort(),
    )
    const reads = oracleDatabaseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = oracleDatabaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['rows.find'].sort())
    expect(mutations).toEqual(
      ['rows.insert', 'rows.insertBatch', 'rows.update', 'rows.delete', 'sql.execute'].sort(),
    )
  })
})
