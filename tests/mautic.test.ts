import { describe, expect, it } from 'vitest'
import { mauticConnector } from '../src/connectors/adapters/mautic.js'

describe('mautic adapter manifest', () => {
  it('classifies itself as the crm category and exposes the mautic kind', () => {
    expect(mauticConnector.manifest.kind).toBe('mautic')
    expect(mauticConnector.manifest.category).toBe('crm')
    expect(mauticConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mauticConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes contact, segment, and company capabilities covering reads and mutations', () => {
    const names = mauticConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.search',
        'contacts.get',
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'contacts.segments.add',
        'contacts.segments.remove',
        'segments.search',
        'segments.get',
        'companies.search',
        'companies.get',
        'companies.create',
        'companies.update',
      ].sort(),
    )
    const reads = mauticConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mauticConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'contacts.search',
        'contacts.get',
        'segments.search',
        'segments.get',
        'companies.search',
        'companies.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'contacts.segments.add',
        'contacts.segments.remove',
        'companies.create',
        'companies.update',
      ].sort(),
    )
  })
})
