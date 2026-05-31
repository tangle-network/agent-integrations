import { describe, expect, it } from 'vitest'
import { documergeConnector } from '../src/connectors/adapters/documerge.js'

describe('documerge adapter manifest', () => {
  it('classifies itself as the storage category and exposes the documerge kind', () => {
    expect(documergeConnector.manifest.kind).toBe('documerge')
    expect(documergeConnector.manifest.category).toBe('storage')
    expect(documergeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = documergeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (combine, convert, merges, split)', () => {
    const names = documergeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.combine',
        'files.convertToPdf',
        'dataRouteMerge.create',
        'documentMerge.create',
        'pdf.split',
      ].sort(),
    )
    const mutations = documergeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'files.combine',
        'files.convertToPdf',
        'dataRouteMerge.create',
        'documentMerge.create',
        'pdf.split',
      ].sort(),
    )
  })
})
