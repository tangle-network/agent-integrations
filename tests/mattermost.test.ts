import { describe, expect, it } from 'vitest'
import { mattermostConnector } from '../src/connectors/adapters/mattermost.js'

describe('mattermost adapter manifest', () => {
  it('exposes the mattermost kind and a comms-grade category', () => {
    expect(mattermostConnector.manifest.kind).toBe('mattermost')
    expect(mattermostConnector.manifest.category).toBe('comms')
    expect(mattermostConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the activepieces catalog', () => {
    const auth = mattermostConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.message only', () => {
    const names = mattermostConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.message'])
    const mutations = mattermostConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.message'])
  })
})
