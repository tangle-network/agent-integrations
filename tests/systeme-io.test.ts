import { describe, expect, it } from 'vitest'
import { systemeIoConnector } from '../src/connectors/adapters/systeme-io.js'

describe('systeme-io adapter manifest', () => {
  it('classifies itself as the crm category and exposes the systeme-io kind', () => {
    expect(systemeIoConnector.manifest.kind).toBe('systeme-io')
    expect(systemeIoConnector.manifest.category).toBe('crm')
    expect(systemeIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = systemeIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contacts and tags', () => {
    const names = systemeIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'contacts.create',
      'contacts.findByEmail',
      'contacts.update',
      'tags.addToContact',
      'tags.removeFromContact',
    ])
    const mutations = systemeIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['contacts.create', 'contacts.update', 'tags.addToContact', 'tags.removeFromContact'])
  })
})
