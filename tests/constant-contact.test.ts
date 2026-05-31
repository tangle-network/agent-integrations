import { describe, expect, it } from 'vitest'
import { constantContactConnector } from '../src/connectors/adapters/constant-contact.js'

describe('constant-contact adapter manifest', () => {
  it('classifies itself as the crm category and exposes the constant-contact kind', () => {
    expect(constantContactConnector.manifest.kind).toBe('constant-contact')
    expect(constantContactConnector.manifest.category).toBe('crm')
    expect(constantContactConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (matches the activepieces piece auth shape)', () => {
    const auth = constantContactConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes the activepieces upsert action plus the adjacent V3 contact/list surface', () => {
    const names = constantContactConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.upsert',
        'contacts.search',
        'contacts.get',
        'contacts.update',
        'contacts.delete',
        'lists.search',
        'lists.get',
        'lists.create',
      ].sort(),
    )
    const reads = constantContactConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = constantContactConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.get', 'contacts.search', 'lists.get', 'lists.search'].sort())
    expect(mutations).toEqual(
      ['contacts.delete', 'contacts.update', 'contacts.upsert', 'lists.create'].sort(),
    )
  })
})
