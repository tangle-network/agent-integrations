import { describe, expect, it } from 'vitest'
import { hunterConnector } from '../src/connectors/adapters/hunter.js'

describe('hunter adapter manifest', () => {
  it('classifies itself as the crm category and exposes the hunter kind', () => {
    expect(hunterConnector.manifest.kind).toBe('hunter')
    expect(hunterConnector.manifest.category).toBe('crm')
    expect(hunterConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = hunterConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (email discovery, verification, leads CRUD, campaigns)', () => {
    const names = hunterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'add.recipients',
        'count.emails',
        'create.lead',
        'delete.lead',
        'find.email',
        'get.lead',
        'search.leads',
        'update.lead',
        'verify.email',
      ].sort(),
    )
    const reads = hunterConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = hunterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['find.email', 'get.lead', 'search.leads'].sort())
    expect(mutations).toEqual(
      [
        'add.recipients',
        'count.emails',
        'create.lead',
        'delete.lead',
        'update.lead',
        'verify.email',
      ].sort(),
    )
  })
})
