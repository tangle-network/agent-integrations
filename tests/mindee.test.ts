import { describe, expect, it } from 'vitest'
import { mindeeConnector } from '../src/connectors/adapters/mindee.js'

describe('mindee adapter manifest', () => {
  it('exposes the mindee kind and a UI-grouping category', () => {
    expect(mindeeConnector.manifest.kind).toBe('mindee')
    expect(mindeeConnector.manifest.category).toBe('other')
    expect(mindeeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = mindeeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: predict document', () => {
    const names = mindeeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['mindee.predict.document'])
    const mutations = mindeeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['mindee.predict.document'])
  })
})
