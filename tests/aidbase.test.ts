import { describe, expect, it } from 'vitest'
import { aidbaseConnector } from '../src/connectors/adapters/aidbase.js'

describe('aidbase adapter manifest', () => {
  it('classifies itself as the crm category and exposes the aidbase kind', () => {
    expect(aidbaseConnector.manifest.kind).toBe('aidbase')
    expect(aidbaseConnector.manifest.category).toBe('crm')
    expect(aidbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = aidbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the six write actions declared by the activepieces piece', () => {
    const names = aidbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'knowledge.add_video',
        'knowledge.add_website',
        'knowledge.add_faq_item',
        'knowledge.create_faq',
        'chatbot.create_reply',
        'training.start',
      ].sort(),
    )
    const reads = aidbaseConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = aidbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    // Every activepieces aidbase action is risk:"write" — there are no reads.
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      [
        'chatbot.create_reply',
        'knowledge.add_faq_item',
        'knowledge.add_video',
        'knowledge.add_website',
        'knowledge.create_faq',
        'training.start',
      ].sort(),
    )
  })
})
