import { describe, expect, it } from 'vitest'
import { mixmaxConnector } from '../src/connectors/adapters/mixmax.js'

describe('mixmax adapter manifest', () => {
  it('classifies itself as the comms category and exposes the mixmax kind', () => {
    expect(mixmaxConnector.manifest.kind).toBe('mixmax')
    expect(mixmaxConnector.manifest.category).toBe('comms')
    expect(mixmaxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = mixmaxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: snippets and contacts CRUD', () => {
    const names = mixmaxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.code.snippet',
        'create.contact',
        'find.contact',
        'list.code.snippets',
        'list.contacts',
      ].sort(),
    )
    const reads = mixmaxConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mixmaxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['find.contact', 'list.code.snippets', 'list.contacts'])
    expect(mutations).toEqual(['create.code.snippet', 'create.contact'])
  })
})
