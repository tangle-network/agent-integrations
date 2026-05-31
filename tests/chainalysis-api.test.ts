import { describe, expect, it } from 'vitest'
import { chainalysisApiConnector } from '../src/connectors/adapters/chainalysis-api.js'

describe('chainalysis-api adapter manifest', () => {
  it('classifies itself as the chainalysis-api kind in the other category', () => {
    expect(chainalysisApiConnector.manifest.kind).toBe('chainalysis-api')
    expect(chainalysisApiConnector.manifest.category).toBe('other')
    expect(chainalysisApiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chainalysisApiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the sanctions screening action from the activepieces catalog', () => {
    const names = chainalysisApiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['check.address.sanction'])
  })
})
