import { describe, expect, it } from 'vitest'
import { griptapeConnector } from '../src/connectors/adapters/griptape.js'

describe('griptape adapter manifest', () => {
  it('classifies itself as other category and exposes the griptape kind', () => {
    expect(griptapeConnector.manifest.kind).toBe('griptape')
    expect(griptapeConnector.manifest.category).toBe('other')
    expect(griptapeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = griptapeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Griptape/i)
  })

  it('covers assistant and structure run capabilities', () => {
    const names = griptapeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'assistants.run.create',
        'assistants.run.get',
        'structures.run.create',
        'structures.run.get',
      ].sort(),
    )
    const mutations = griptapeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['assistants.run.create', 'structures.run.create'].sort())
  })
})
