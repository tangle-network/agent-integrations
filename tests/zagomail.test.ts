import { describe, expect, it } from 'vitest'
import { zagomailConnector } from '../src/connectors/adapters/zagomail.js'

describe('zagomail adapter manifest', () => {
  it('classifies itself as the crm category and exposes the zagomail kind', () => {
    expect(zagomailConnector.manifest.kind).toBe('zagomail')
    expect(zagomailConnector.manifest.category).toBe('crm')
    expect(zagomailConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zagomailConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (subscribers, tags, campaigns)', () => {
    const names = zagomailConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.create',
        'subscribers.update',
        'subscribers.get',
        'subscribers.search',
        'subscribers.add-tags',
        'tags.create',
        'campaigns.get',
        'campaigns.list',
      ].sort(),
    )
    const reads = zagomailConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zagomailConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['subscribers.get', 'subscribers.search', 'campaigns.get', 'campaigns.list'].sort())
    expect(mutations).toEqual(
      ['subscribers.create', 'subscribers.update', 'subscribers.add-tags', 'tags.create'].sort(),
    )
  })
})
