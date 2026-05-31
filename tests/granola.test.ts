import { describe, expect, it } from 'vitest'
import { granolaConnector } from '../src/connectors/adapters/granola.js'

describe('granola adapter manifest', () => {
  it('classifies itself as the doc category and exposes the granola kind', () => {
    expect(granolaConnector.manifest.kind).toBe('granola')
    expect(granolaConnector.manifest.category).toBe('doc')
    expect(granolaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = granolaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (list notes, get note)', () => {
    const names = granolaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['notes.get', 'notes.list'].sort())

    const reads = granolaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['notes.get', 'notes.list'].sort())

    const mutations = granolaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([].sort())
  })
})
