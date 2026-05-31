import { describe, expect, it } from 'vitest'
import { kallabotAiConnector } from '../src/connectors/adapters/kallabot-ai.js'

describe('kallabot-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the kallabot-ai kind', () => {
    expect(kallabotAiConnector.manifest.kind).toBe('kallabot-ai')
    expect(kallabotAiConnector.manifest.category).toBe('other')
    expect(kallabotAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = kallabotAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Kallabot/i)
  })

  it('covers the calls, contacts, and campaigns capability surface', () => {
    const names = kallabotAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.make',
        'calls.details',
        'contacts.add_to_list',
        'contacts.list_get',
        'contact_lists.create',
        'contact_lists.edit',
        'campaigns.create',
        'campaigns.delete',
      ].sort(),
    )
    const mutations = kallabotAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'calls.make',
        'contacts.add_to_list',
        'contact_lists.create',
        'contact_lists.edit',
        'campaigns.create',
        'campaigns.delete',
      ].sort(),
    )
  })
})
