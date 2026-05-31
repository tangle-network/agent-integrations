import { describe, expect, it } from 'vitest'
import { senjaConnector } from '../src/connectors/adapters/senja.js'

describe('senja adapter manifest', () => {
  it('classifies itself as the crm category and exposes the senja kind', () => {
    expect(senjaConnector.manifest.kind).toBe('senja')
    expect(senjaConnector.manifest.category).toBe('crm')
    expect(senjaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = senjaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (testimonials.list, testimonials.get, testimonials.create)', () => {
    const names = senjaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['testimonials.create', 'testimonials.get', 'testimonials.list'].sort())
    const reads = senjaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = senjaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['testimonials.get', 'testimonials.list'].sort())
    expect(mutations).toEqual(['testimonials.create'].sort())
  })
})
