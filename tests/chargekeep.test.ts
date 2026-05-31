import { describe, expect, it } from 'vitest'
import { chargekeepConnector } from '../src/connectors/adapters/chargekeep.js'

describe('chargekeep adapter manifest', () => {
  it('classifies itself as the crm category and exposes the chargekeep kind', () => {
    expect(chargekeepConnector.manifest.kind).toBe('chargekeep')
    expect(chargekeepConnector.manifest.category).toBe('crm')
    expect(chargekeepConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chargekeepConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action surface (contacts, subscriptions, invoices, products)', () => {
    const names = chargekeepConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.upsert',
        'contacts.upsert.extended',
        'subscriptions.upsert',
        'invoices.create',
        'products.create',
        'contacts.get',
      ].sort(),
    )
    const reads = chargekeepConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chargekeepConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.get'])
    expect(mutations).toEqual(
      [
        'contacts.upsert',
        'contacts.upsert.extended',
        'subscriptions.upsert',
        'invoices.create',
        'products.create',
      ].sort(),
    )
  })
})
