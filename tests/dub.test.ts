import { describe, expect, it } from 'vitest'
import { dubConnector } from '../src/connectors/adapters/dub.js'

describe('dub adapter manifest', () => {
  it('exposes the dub kind and an explicit category', () => {
    expect(dubConnector.manifest.kind).toBe('dub')
    expect(dubConnector.manifest.category).toBe('other')
    expect(dubConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = dubConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (create/get/list/update/delete link)', () => {
    const names = dubConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['links.create', 'links.get', 'links.list', 'links.update', 'links.delete'].sort(),
    )
    const reads = dubConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = dubConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['links.get', 'links.list'].sort())
    expect(mutations).toEqual(['links.create', 'links.delete', 'links.update'].sort())
  })
})
