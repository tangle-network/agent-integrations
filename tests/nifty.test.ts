import { describe, expect, it } from 'vitest'
import { niftyConnector } from '../src/connectors/adapters/nifty.js'

describe('nifty adapter manifest', () => {
  it('classifies itself as the doc category and exposes the nifty kind', () => {
    expect(niftyConnector.manifest.kind).toBe('nifty')
    expect(niftyConnector.manifest.category).toBe('doc')
    expect(niftyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = niftyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: creating a task', () => {
    const names = niftyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['tasks.create'])
    const mutations = niftyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['tasks.create'])
  })
})
