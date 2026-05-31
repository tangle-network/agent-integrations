import { describe, expect, it } from 'vitest'
import { digitalPilotConnector } from '../src/connectors/adapters/digital-pilot.js'

describe('digital-pilot adapter manifest', () => {
  it('classifies itself as the other category and exposes the digital-pilot kind', () => {
    expect(digitalPilotConnector.manifest.kind).toBe('digital-pilot')
    expect(digitalPilotConnector.manifest.category).toBe('other')
    expect(digitalPilotConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = digitalPilotConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes target account management and visit search capabilities', () => {
    const names = digitalPilotConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'target-accounts.add',
        'target-accounts.remove',
        'visits.search',
        'visits.get',
      ].sort(),
    )
    const reads = digitalPilotConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = digitalPilotConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['visits.get', 'visits.search'].sort())
    expect(mutations).toEqual(['target-accounts.add', 'target-accounts.remove'].sort())
  })
})
