import { describe, expect, it } from 'vitest'
import { postgresConnector } from '../src/connectors/adapters/postgres.js'

describe('postgres adapter manifest', () => {
  it('classifies itself as the database category and exposes the postgres kind', () => {
    expect(postgresConnector.manifest.kind).toBe('postgres')
    expect(postgresConnector.manifest.category).toBe('database')
    expect(postgresConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = postgresConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the postgresql action set (query execution)', () => {
    const names = postgresConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['query.execute'].sort())
    const reads = postgresConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['query.execute'].sort())
  })
})
