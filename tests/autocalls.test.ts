import { describe, expect, it } from 'vitest'
import { autocallsConnector } from '../src/connectors/adapters/autocalls.js'

describe('autocalls adapter manifest', () => {
  it('classifies itself as the comms category and exposes the autocalls kind', () => {
    expect(autocallsConnector.manifest.kind).toBe('autocalls')
    expect(autocallsConnector.manifest.category).toBe('comms')
    expect(autocallsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = autocallsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: make call, add/delete lead, send sms, campaign control', () => {
    const names = autocallsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'make.phone.call',
        'add.lead',
        'send.sms',
        'campaign.control',
        'delete.lead',
      ].sort(),
    )
    const reads = autocallsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = autocallsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      ['make.phone.call', 'add.lead', 'send.sms', 'campaign.control', 'delete.lead'].sort(),
    )
  })
})
