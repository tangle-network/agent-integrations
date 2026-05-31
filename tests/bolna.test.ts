import { describe, expect, it } from 'vitest'
import { bolnaConnector } from '../src/connectors/adapters/bolna.js'

describe('bolna adapter manifest', () => {
  it('classifies itself as the comms category and exposes the bolna kind', () => {
    expect(bolnaConnector.manifest.kind).toBe('bolna')
    expect(bolnaConnector.manifest.category).toBe('comms')
    expect(bolnaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = bolnaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog makePhoneCall action and agent/execution reads', () => {
    const names = bolnaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.list',
        'agents.get',
        'executions.list',
        'executions.get',
        'calls.make',
        'calls.batch',
      ].sort(),
    )
    const reads = bolnaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = bolnaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['agents.get', 'agents.list', 'executions.get', 'executions.list'])
    expect(mutations).toEqual(['calls.batch', 'calls.make'])
  })
})
