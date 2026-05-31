import { describe, expect, it } from 'vitest'
import { twentyConnector } from '../src/connectors/adapters/twenty.js'

describe('twenty adapter manifest', () => {
  it('classifies itself as the crm category and exposes the twenty kind', () => {
    expect(twentyConnector.manifest.kind).toBe('twenty')
    expect(twentyConnector.manifest.category).toBe('crm')
    expect(twentyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = twentyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, companies, opportunities)', () => {
    const names = twentyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.find',
        'contacts.update',
        'companies.create',
        'companies.find',
        'companies.update',
        'opportunities.create',
      ].sort(),
    )
    const reads = twentyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = twentyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find', 'companies.find'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'companies.create',
        'companies.update',
        'opportunities.create',
      ].sort(),
    )
  })
})
