import { describe, expect, it } from 'vitest'
import { clearoutphoneConnector } from '../src/connectors/adapters/clearoutphone.js'

describe('clearoutphone adapter manifest', () => {
  it('classifies itself as the comms category and exposes the clearoutphone kind', () => {
    expect(clearoutphoneConnector.manifest.kind).toBe('clearoutphone')
    expect(clearoutphoneConnector.manifest.category).toBe('comms')
    expect(clearoutphoneConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = clearoutphoneConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: find carrier, find mobile, validate', () => {
    const names = clearoutphoneConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['find.phone.number.carrier', 'find.phone.number.is.mobile', 'validate.phone.number'])
    const mutations = clearoutphoneConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['validate.phone.number'])
  })
})
