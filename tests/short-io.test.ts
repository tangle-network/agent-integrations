import { describe, expect, it } from 'vitest'
import { shortIoConnector } from '../src/connectors/adapters/short-io.js'

describe('short-io adapter manifest', () => {
  it('classifies itself as the storage category and exposes the short-io kind', () => {
    expect(shortIoConnector.manifest.kind).toBe('short-io')
    expect(shortIoConnector.manifest.category).toBe('storage')
    expect(shortIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = shortIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (links, targeting, clicks)', () => {
    const names = shortIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'links.create',
        'links.update',
        'links.delete',
        'links.get',
        'links.list',
        'links.clicks',
        'targeting.create',
      ].sort(),
    )
    const reads = shortIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = shortIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['links.clicks', 'links.get', 'links.list'].sort())
    expect(mutations).toEqual(
      ['links.create', 'links.delete', 'links.update', 'targeting.create'].sort(),
    )
  })
})
