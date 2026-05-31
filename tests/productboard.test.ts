import { describe, expect, it } from 'vitest'
import { productboardConnector } from '../src/connectors/adapters/productboard.js'

describe('productboard adapter manifest', () => {
  it('classifies itself as the doc category and exposes the productboard kind', () => {
    expect(productboardConnector.manifest.kind).toBe('productboard')
    expect(productboardConnector.manifest.category).toBe('doc')
    expect(productboardConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = productboardConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (features, notes)', () => {
    const names = productboardConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'features.create',
        'features.get',
        'features.list',
        'features.update',
        'notes.create',
        'notes.get',
        'notes.list',
      ].sort(),
    )
    const reads = productboardConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = productboardConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['features.get', 'features.list', 'notes.get', 'notes.list'].sort())
    expect(mutations).toEqual(['features.create', 'features.update', 'notes.create'].sort())
  })
})
