import { describe, expect, it } from 'vitest'
import { instasentConnector } from '../src/connectors/adapters/instasent.js'

describe('instasent adapter manifest', () => {
  it('classifies itself as the crm category and exposes the instasent kind', () => {
    expect(instasentConnector.manifest.kind).toBe('instasent')
    expect(instasentConnector.manifest.category).toBe('crm')
    expect(instasentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = instasentConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (add/update contact, create event, delete contact)', () => {
    const names = instasentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.add_or_update',
        'events.create',
        'contacts.delete',
      ].sort(),
    )
    const mutations = instasentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.add_or_update',
        'events.create',
        'contacts.delete',
      ].sort(),
    )
  })
})
