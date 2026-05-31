import { describe, expect, it } from 'vitest'
import { airparserConnector } from '../src/connectors/adapters/airparser.js'

describe('airparser adapter manifest', () => {
  it('classifies itself as the doc category and exposes the airparser kind', () => {
    expect(airparserConnector.manifest.kind).toBe('airparser')
    expect(airparserConnector.manifest.category).toBe('doc')
    expect(airparserConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = airparserConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/airparser/i)
  })

  it('covers document upload, extraction, and retrieval capabilities', () => {
    const names = airparserConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['documents.extract', 'documents.get', 'documents.upload'].sort())
    const mutations = airparserConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['documents.upload'].sort())
  })
})
