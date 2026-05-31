import { describe, expect, it } from 'vitest'
import { manychatConnector } from '../src/connectors/adapters/manychat.js'

describe('manychat adapter manifest', () => {
  it('classifies itself as the crm category and exposes the manychat kind', () => {
    expect(manychatConnector.manifest.kind).toBe('manychat')
    expect(manychatConnector.manifest.category).toBe('crm')
    expect(manychatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = manychatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (find/create/send/tag/custom-field)', () => {
    const names = manychatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.find.by.custom.field',
        'subscribers.find.by.name',
        'subscribers.create',
        'subscribers.send.content',
        'subscribers.custom_field.set',
        'subscribers.tag.add',
        'subscribers.tag.remove',
      ].sort(),
    )
    const reads = manychatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = manychatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['subscribers.find.by.custom.field', 'subscribers.find.by.name'].sort(),
    )
    expect(mutations).toEqual(
      [
        'subscribers.create',
        'subscribers.custom_field.set',
        'subscribers.send.content',
        'subscribers.tag.add',
        'subscribers.tag.remove',
      ].sort(),
    )
  })
})
