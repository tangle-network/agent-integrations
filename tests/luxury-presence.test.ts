import { describe, expect, it } from 'vitest'
import { luxuryPresenceConnector } from '../src/connectors/adapters/luxury-presence.js'

describe('luxury-presence adapter manifest', () => {
  it('exposes the luxury-presence kind under the crm category with authoritative consistency', () => {
    expect(luxuryPresenceConnector.manifest.kind).toBe('luxury-presence')
    expect(luxuryPresenceConnector.manifest.category).toBe('crm')
    expect(luxuryPresenceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(luxuryPresenceConnector.manifest.displayName).toBe('Luxury Presence')
  })

  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = luxuryPresenceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('api key')
  })

  it('covers lead create, update, list, and get against the LP Lead Connect surface', () => {
    const names = luxuryPresenceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['leads.create', 'leads.get', 'leads.list', 'leads.update'].sort())
  })

  it('splits capabilities correctly between reads and mutations', () => {
    const reads = luxuryPresenceConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = luxuryPresenceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['leads.get', 'leads.list'])
    expect(mutations).toEqual(['leads.create', 'leads.update'])
  })
})
