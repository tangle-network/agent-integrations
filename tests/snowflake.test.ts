import { describe, expect, it } from 'vitest'
import { snowflakeConnector } from '../src/connectors/adapters/snowflake.js'

describe('snowflake adapter manifest', () => {
  it('classifies itself as the database category and exposes the snowflake kind', () => {
    expect(snowflakeConnector.manifest.kind).toBe('snowflake')
    expect(snowflakeConnector.manifest.category).toBe('database')
    expect(snowflakeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with Snowflake-specific endpoints', () => {
    const auth = snowflakeConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/snowflake/)
    expect(auth.tokenUrl).toMatch(/snowflake/)
  })

  it('covers queries, rows, tables, procedures, stages, and dynamic tables capability surface', () => {
    const names = snowflakeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('queries.run')
    expect(names).toContain('queries.runMultiple')
    expect(names).toContain('rows.insert')
    expect(names).toContain('rows.insertMultiple')
    expect(names).toContain('rows.update')
    expect(names).toContain('rows.upsert')
    expect(names).toContain('rows.delete')
    expect(names).toContain('rows.getById')
    expect(names).toContain('rows.search')
    expect(names).toContain('tables.list')
    expect(names).toContain('tables.getSchema')
    expect(names).toContain('procedures.execute')
    expect(names).toContain('stages.loadData')
    expect(names).toContain('dynamicTables.create')
  })

  it('marks write operations as mutations', () => {
    const mutations = snowflakeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('rows.insert')
    expect(mutations).toContain('rows.insertMultiple')
    expect(mutations).toContain('rows.update')
    expect(mutations).toContain('rows.upsert')
    expect(mutations).toContain('rows.delete')
    expect(mutations).toContain('procedures.execute')
    expect(mutations).toContain('stages.loadData')
    expect(mutations).toContain('dynamicTables.create')
  })

  it('marks read-only operations as read', () => {
    const reads = snowflakeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('queries.run')
    expect(reads).toContain('queries.runMultiple')
    expect(reads).toContain('rows.getById')
    expect(reads).toContain('rows.search')
    expect(reads).toContain('tables.list')
    expect(reads).toContain('tables.getSchema')
  })
})
