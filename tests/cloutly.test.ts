import { describe, expect, it } from 'vitest'
import { cloutlyConnector } from '../src/connectors/adapters/cloutly.js'

describe('cloutly adapter manifest', () => {
  it('classifies itself as the crm category and exposes the cloutly kind', () => {
    expect(cloutlyConnector.manifest.kind).toBe('cloutly')
    expect(cloutlyConnector.manifest.category).toBe('crm')
    expect(cloutlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = cloutlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: sending a review invite', () => {
    const names = cloutlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['reviews.sendInvite'])
    const mutations = cloutlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['reviews.sendInvite'])
  })
})
