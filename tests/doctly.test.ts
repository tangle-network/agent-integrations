import { describe, expect, it } from 'vitest'
import { doctlyConnector } from '../src/connectors/adapters/doctly.js'

describe('doctly adapter manifest', () => {
  it('classifies itself as the doc category and exposes the doctly kind', () => {
    expect(doctlyConnector.manifest.kind).toBe('doctly')
    expect(doctlyConnector.manifest.category).toBe('doc')
    expect(doctlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = doctlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: convert.pdf.to.text plus the documents.get poll', () => {
    const names = doctlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['convert.pdf.to.text', 'documents.get'].sort())

    const reads = doctlyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = doctlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['documents.get'])
    expect(mutations).toEqual(['convert.pdf.to.text'])
  })
})
