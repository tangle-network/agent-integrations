import { describe, expect, it } from 'vitest'
import { justInvoiceConnector } from '../src/connectors/adapters/just-invoice.js'

describe('just-invoice adapter manifest', () => {
  it('exposes the just-invoice kind under the commerce category', () => {
    expect(justInvoiceConnector.manifest.kind).toBe('just-invoice')
    expect(justInvoiceConnector.manifest.category).toBe('commerce')
    expect(justInvoiceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = justInvoiceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog invoice operations: create and delete', () => {
    const names = justInvoiceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['invoices.create', 'invoices.delete'])

    const mutations = justInvoiceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['invoices.create', 'invoices.delete'])
  })
})
