import { describe, expect, it } from 'vitest'
import { influencersClubConnector } from '../src/connectors/adapters/influencers-club.js'

describe('influencers-club adapter manifest', () => {
  it('classifies itself as the crm category and exposes the influencers-club kind', () => {
    expect(influencersClubConnector.manifest.kind).toBe('influencers-club')
    expect(influencersClubConnector.manifest.category).toBe('crm')
    expect(influencersClubConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = influencersClubConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: enrich by email/handle and find similar creators', () => {
    const names = influencersClubConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'creators.enrich_by_email',
        'creators.enrich_by_handle',
        'creators.find_similar',
      ].sort(),
    )
    const reads = influencersClubConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = influencersClubConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['creators.find_similar'])
    expect(mutations).toEqual(
      ['creators.enrich_by_email', 'creators.enrich_by_handle'].sort(),
    )
  })
})
