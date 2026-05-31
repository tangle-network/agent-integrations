import { describe, expect, it } from 'vitest'
import { fellowConnector } from '../src/connectors/adapters/fellow.js'

describe('fellow adapter manifest', () => {
  it('classifies itself as the other category and exposes the fellow kind', () => {
    expect(fellowConnector.manifest.kind).toBe('fellow')
    expect(fellowConnector.manifest.category).toBe('other')
    expect(fellowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = fellowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (notes and recordings)', () => {
    const names = fellowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'notes.get',
        'notes.list',
        'recordings.list',
      ].sort(),
    )
    const reads = fellowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['notes.get', 'notes.list', 'recordings.list'].sort(),
    )
  })
})
