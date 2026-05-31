import { describe, expect, it } from 'vitest'
import { quadernoConnector } from '../src/connectors/adapters/quaderno.js'

describe('quaderno adapter manifest', () => {
  it('classifies itself as the crm category and exposes the quaderno kind', () => {
    expect(quadernoConnector.manifest.kind).toBe('quaderno')
    expect(quadernoConnector.manifest.category).toBe('crm')
    expect(quadernoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = quadernoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, invoices, expenses)', () => {
    const names = quadernoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.find',
        'contacts.create',
        'invoices.create',
        'expenses.create',
      ].sort(),
    )
    const reads = quadernoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = quadernoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'invoices.create',
        'expenses.create',
      ].sort(),
    )
  })
})
