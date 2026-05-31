import { describe, expect, it } from 'vitest'
import { heymarketSmsConnector } from '../src/connectors/adapters/heymarket-sms.js'

describe('heymarket-sms adapter manifest', () => {
  it('classifies itself as the crm category and exposes the heymarket-sms kind', () => {
    expect(heymarketSmsConnector.manifest.kind).toBe('heymarket-sms')
    expect(heymarketSmsConnector.manifest.category).toBe('crm')
    expect(heymarketSmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = heymarketSmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contact upsert, custom + template send, list update', () => {
    const names = heymarketSmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.createOrUpdate',
        'messages.sendCustom',
        'messages.sendTemplate',
        'lists.update',
      ].sort(),
    )
    const mutations = heymarketSmsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.createOrUpdate',
        'messages.sendCustom',
        'messages.sendTemplate',
        'lists.update',
      ].sort(),
    )
  })
})
