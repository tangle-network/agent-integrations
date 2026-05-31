import { describe, expect, it } from 'vitest'
import { barcodeLookupConnector } from '../src/connectors/adapters/barcode-lookup.js'

describe('barcode-lookup adapter manifest', () => {
  it('classifies itself as the crm category and exposes the barcode-lookup kind', () => {
    expect(barcodeLookupConnector.manifest.kind).toBe('barcode-lookup')
    expect(barcodeLookupConnector.manifest.category).toBe('crm')
    expect(barcodeLookupConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = barcodeLookupConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: search.by.barcode as a read', () => {
    const names = barcodeLookupConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['search.by.barcode'])
    const reads = barcodeLookupConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = barcodeLookupConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['search.by.barcode'])
    expect(mutations).toEqual([])
  })
})
