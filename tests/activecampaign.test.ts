import { describe, expect, it } from 'vitest'
import { activecampaignConnector } from '../src/connectors/adapters/activecampaign.js'

describe('activecampaign adapter manifest', () => {
  it('classifies itself as the crm category and exposes the activecampaign kind', () => {
    expect(activecampaignConnector.manifest.kind).toBe('activecampaign')
    expect(activecampaignConnector.manifest.category).toBe('crm')
    expect(activecampaignConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = activecampaignConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (accounts, contacts, lists, tags)', () => {
    const names = activecampaignConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'accounts.create',
        'accounts.update',
        'accounts.get',
        'accounts.search',
        'contacts.list.subscription',
        'contacts.create',
        'contacts.update',
        'contacts.get',
        'contacts.search',
        'accounts.contacts.associate',
        'contacts.tags.add',
      ].sort(),
    )
    const reads = activecampaignConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = activecampaignConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['accounts.get', 'accounts.search', 'contacts.get', 'contacts.search'].sort(),
    )
    expect(mutations).toEqual(
      [
        'accounts.contacts.associate',
        'accounts.create',
        'accounts.update',
        'contacts.create',
        'contacts.list.subscription',
        'contacts.tags.add',
        'contacts.update',
      ].sort(),
    )
  })
})
