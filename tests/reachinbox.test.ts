import { describe, expect, it } from 'vitest'
import { reachinboxConnector } from '../src/connectors/adapters/reachinbox.js'

describe('reachinbox adapter manifest', () => {
  it('classifies itself as the crm category and exposes the reachinbox kind', () => {
    expect(reachinboxConnector.manifest.kind).toBe('reachinbox')
    expect(reachinboxConnector.manifest.category).toBe('crm')
    expect(reachinboxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = reachinboxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/ReachInbox/i)
  })

  it('covers campaigns, leads, blocklist, warmup, email, and schedule capabilities', () => {
    const names = reachinboxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'blocklist.add',
        'campaigns.list',
        'campaigns.pause',
        'campaigns.start',
        'campaigns.summary',
        'email.add',
        'leads.add',
        'leads.remove',
        'leads.update',
        'schedule.set',
        'warmup.enable',
        'warmup.pause',
      ].sort(),
    )
    const mutations = reachinboxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'blocklist.add',
        'campaigns.pause',
        'campaigns.start',
        'email.add',
        'leads.add',
        'leads.remove',
        'leads.update',
        'schedule.set',
        'warmup.enable',
        'warmup.pause',
      ].sort(),
    )
  })
})
