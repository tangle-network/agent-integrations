import { describe, expect, it } from 'vitest'
import { parseurConnector } from '../src/connectors/adapters/parseur.js'

describe('parseur adapter manifest', () => {
  it('classifies itself as the comms category and exposes the parseur kind', () => {
    expect(parseurConnector.manifest.kind).toBe('parseur')
    expect(parseurConnector.manifest.category).toBe('comms')
    expect(parseurConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = parseurConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Parseur/i)
  })

  it('covers document search, retrieval, creation, and reprocessing capability surface', () => {
    const names = parseurConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.createFromFile',
        'documents.create',
        'documents.find',
        'documents.get',
        'documents.reprocess',
      ].sort(),
    )
    const mutations = parseurConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'documents.create',
        'documents.createFromFile',
        'documents.reprocess',
      ].sort(),
    )
  })
})
