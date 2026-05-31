import { describe, expect, it } from 'vitest'
import { cohereConnector } from '../src/connectors/adapters/cohere.js'

describe('cohere adapter manifest', () => {
  it('exposes the cohere kind and is grouped under the other category', () => {
    expect(cohereConnector.manifest.kind).toBe('cohere')
    expect(cohereConnector.manifest.category).toBe('other')
    expect(cohereConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cohereConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces generate-text action', () => {
    const names = cohereConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['generate.text'])
    const mutations = cohereConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['generate.text'])
  })
})
