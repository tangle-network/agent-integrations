import { describe, expect, it } from 'vitest'
import { exaConnector } from '../src/connectors/adapters/exa.js'

describe('exa adapter manifest', () => {
  it('classifies itself as the other category and exposes the exa kind', () => {
    expect(exaConnector.manifest.kind).toBe('exa')
    expect(exaConnector.manifest.category).toBe('other')
    expect(exaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = exaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: search, similar links, contents, and answer generation', () => {
    const names = exaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['answer.generate', 'contents.get', 'search.perform', 'search.similar'])
    const reads = exaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['answer.generate', 'contents.get', 'search.perform', 'search.similar'])
  })
})
