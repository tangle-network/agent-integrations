import { describe, expect, it } from 'vitest'
import { googleSearchConnector } from '../src/connectors/adapters/google-search.js'

describe('google-search adapter manifest', () => {
  it('exposes the google-search kind under the other category', () => {
    expect(googleSearchConnector.manifest.kind).toBe('google-search')
    expect(googleSearchConnector.manifest.category).toBe('other')
    expect(googleSearchConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = googleSearchConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (search)', () => {
    const names = googleSearchConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['search'])
    const reads = googleSearchConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['search'])
  })
})
