import { describe, expect, it } from 'vitest'
import { beehiivConnector } from '../src/connectors/adapters/beehiiv.js'

describe('beehiiv adapter manifest', () => {
  it('classifies itself as the crm category and exposes the beehiiv kind', () => {
    expect(beehiivConnector.manifest.kind).toBe('beehiiv')
    expect(beehiivConnector.manifest.category).toBe('crm')
    expect(beehiivConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = beehiivConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Beehiiv/i)
  })

  it('covers subscriptions, automations, and posts capability surface', () => {
    const names = beehiivConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscriptions.create',
        'subscriptions.update',
        'automations.list',
        'subscriptions.add.to.automation',
        'posts.list',
      ].sort(),
    )
    const mutations = beehiivConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['subscriptions.create', 'subscriptions.update', 'subscriptions.add.to.automation'].sort(),
    )
  })
})
