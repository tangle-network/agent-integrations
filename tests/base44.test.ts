import { describe, expect, it } from 'vitest'
import { base44Connector } from '../src/connectors/adapters/base44.js'

describe('base44 adapter manifest', () => {
  it('classifies itself as the other category and exposes the base44 kind', () => {
    expect(base44Connector.manifest.kind).toBe('base44')
    expect(base44Connector.manifest.category).toBe('other')
    expect(base44Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = base44Connector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (create, find, findOrCreate)', () => {
    const names = base44Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'entities.create',
        'entities.find',
        'entities.findOrCreate',
      ].sort(),
    )
    const reads = base44Connector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = base44Connector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['entities.find'].sort())
    expect(mutations).toEqual(['entities.create', 'entities.findOrCreate'].sort())
  })
})
