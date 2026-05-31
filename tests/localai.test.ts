import { describe, expect, it } from 'vitest'
import { localaiConnector } from '../src/connectors/adapters/localai.js'

describe('localai adapter manifest', () => {
  it('classifies itself as the other category and exposes the localai kind', () => {
    expect(localaiConnector.manifest.kind).toBe('localai')
    expect(localaiConnector.manifest.category).toBe('other')
    expect(localaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = localaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: model listing and the askLocalAI chat completion', () => {
    const names = localaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['ask.local.ai', 'models.list'].sort())
    const reads = localaiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = localaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['models.list'])
    expect(mutations).toEqual(['ask.local.ai'])
  })
})
