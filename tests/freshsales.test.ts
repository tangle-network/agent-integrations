import { describe, expect, it } from 'vitest'
import { freshsalesConnector } from '../src/connectors/adapters/freshsales.js'

describe('freshsales adapter manifest', () => {
  it('classifies itself as the crm category and exposes the freshsales kind', () => {
    expect(freshsalesConnector.manifest.kind).toBe('freshsales')
    expect(freshsalesConnector.manifest.category).toBe('crm')
    expect(freshsalesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = freshsalesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the activepieces fresh.sales.create.contact action plus the read/update primitives needed to operate it', () => {
    const names = freshsalesConnector.manifest.capabilities.map((c) => c.name)
    // The activepieces piece advertises a single action — contacts.create —
    // which this adapter covers, alongside the surrounding read+update
    // surface needed for an agent to follow up on the created record.
    expect(names).toContain('contacts.create')
    const create = freshsalesConnector.manifest.capabilities.find((c) => c.name === 'contacts.create')
    expect(create?.class).toBe('mutation')

    const mutations = freshsalesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    const reads = freshsalesConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('contacts.create')
    expect(reads).toContain('contacts.get')
  })
})
