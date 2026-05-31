import { describe, expect, it } from 'vitest'
import { plausibleConnector } from '../src/connectors/adapters/plausible.js'

describe('plausible adapter manifest', () => {
  it('classifies itself as other category and exposes the plausible kind', () => {
    expect(plausibleConnector.manifest.kind).toBe('plausible')
    expect(plausibleConnector.manifest.category).toBe('other')
    expect(plausibleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = plausibleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (teams, sites, goals, custom properties, shared links, guests)', () => {
    const names = plausibleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'teams.list',
        'sites.list',
        'sites.get',
        'sites.create',
        'sites.update',
        'sites.delete',
        'goals.list',
        'goals.create',
        'goals.delete',
        'custom_properties.list',
        'custom_properties.create',
        'custom_properties.delete',
        'shared_links.create',
        'guests.list',
        'guests.invite',
        'guests.remove',
      ].sort(),
    )
    const reads = plausibleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = plausibleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['teams.list', 'sites.list', 'sites.get', 'goals.list', 'custom_properties.list', 'guests.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'sites.create',
        'sites.update',
        'sites.delete',
        'goals.create',
        'goals.delete',
        'custom_properties.create',
        'custom_properties.delete',
        'shared_links.create',
        'guests.invite',
        'guests.remove',
      ].sort(),
    )
  })
})
