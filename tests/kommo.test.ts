import { describe, expect, it } from 'vitest'
import { kommoConnector } from '../src/connectors/adapters/kommo.js'

describe('kommo adapter manifest', () => {
  it('classifies itself as the comms category and exposes the kommo kind', () => {
    expect(kommoConnector.manifest.kind).toBe('kommo')
    expect(kommoConnector.manifest.category).toBe('comms')
    expect(kommoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = kommoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog surface: leads, contacts, companies, tasks, notes, tags', () => {
    const names = kommoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.get',
        'leads.search',
        'leads.get',
        'leads.create',
        'leads.update',
        'contacts.search',
        'contacts.get',
        'contacts.create',
        'contacts.update',
        'companies.search',
        'companies.get',
        'companies.create',
        'companies.update',
        'tags.add',
        'tags.remove',
        'tasks.search',
        'tasks.create',
        'notes.create',
      ].sort(),
    )
    const reads = kommoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kommoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'account.get',
        'companies.get',
        'companies.search',
        'contacts.get',
        'contacts.search',
        'leads.get',
        'leads.search',
        'tasks.search',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'companies.create',
        'companies.update',
        'contacts.create',
        'contacts.update',
        'leads.create',
        'leads.update',
        'notes.create',
        'tags.add',
        'tags.remove',
        'tasks.create',
      ].sort(),
    )
  })
})
