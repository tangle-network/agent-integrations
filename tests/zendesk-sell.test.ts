import { describe, expect, it } from 'vitest'
import { zendeskSellConnector } from '../src/connectors/adapters/zendesk-sell.js'

describe('zendesk-sell adapter manifest', () => {
  it('classifies itself as the crm category and exposes the zendesk-sell kind', () => {
    expect(zendeskSellConnector.manifest.kind).toBe('zendesk-sell')
    expect(zendeskSellConnector.manifest.category).toBe('crm')
    expect(zendeskSellConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = zendeskSellConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Zendesk/i)
  })

  it('covers contact, lead, deal, and note capability surface', () => {
    const names = zendeskSellConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.find',
        'contacts.update',
        'deals.create',
        'deals.find',
        'deals.update',
        'leads.create',
        'leads.find',
        'notes.create',
      ].sort(),
    )
    const mutations = zendeskSellConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'deals.create',
        'deals.update',
        'leads.create',
        'notes.create',
      ].sort(),
    )
  })
})
