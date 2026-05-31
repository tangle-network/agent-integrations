import { describe, expect, it } from 'vitest'
import { peekshotConnector } from '../src/connectors/adapters/peekshot.js'

describe('peekshot adapter manifest', () => {
  it('classifies itself as the doc category and exposes the peekshot kind', () => {
    expect(peekshotConnector.manifest.kind).toBe('peekshot')
    expect(peekshotConnector.manifest.category).toBe('doc')
    expect(peekshotConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = peekshotConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: capturing screenshots', () => {
    const names = peekshotConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['capture.screenshot'])
    const mutations = peekshotConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['capture.screenshot'])
  })
})
