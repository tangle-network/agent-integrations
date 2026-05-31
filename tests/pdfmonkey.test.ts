import { describe, expect, it } from 'vitest'
import { pdfmonkeyConnector } from '../src/connectors/adapters/pdfmonkey.js'

describe('pdfmonkey adapter manifest', () => {
  it('classifies itself as the storage category and exposes the pdfmonkey kind', () => {
    expect(pdfmonkeyConnector.manifest.kind).toBe('pdfmonkey')
    expect(pdfmonkeyConnector.manifest.category).toBe('storage')
    expect(pdfmonkeyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = pdfmonkeyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (generate, find, list, delete)', () => {
    const names = pdfmonkeyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['documents.delete', 'documents.find', 'documents.generate', 'documents.list'].sort())
    const reads = pdfmonkeyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = pdfmonkeyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['documents.find', 'documents.list'].sort())
    expect(mutations).toEqual(['documents.delete', 'documents.generate'].sort())
  })
})
