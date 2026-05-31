import { describe, expect, it } from 'vitest'
import { crispConnector } from '../src/connectors/adapters/crisp.js'

describe('crisp adapter manifest', () => {
  it('classifies itself as the crm category and exposes the crisp kind', () => {
    expect(crispConnector.manifest.kind).toBe('crisp')
    expect(crispConnector.manifest.category).toBe('crm')
    expect(crispConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = crispConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (conversation, note, contact, profile, state)', () => {
    const names = crispConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'conversation.create',
        'conversation.note.add',
        'contact.upsert',
        'user.profile.find',
        'conversation.state.update',
        'conversation.find',
      ].sort(),
    )
    const reads = crispConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = crispConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['conversation.find', 'user.profile.find'].sort())
    expect(mutations).toEqual(
      [
        'conversation.create',
        'conversation.note.add',
        'contact.upsert',
        'conversation.state.update',
      ].sort(),
    )
  })
})
