import { describe, expect, it } from 'vitest'
import { memConnector } from '../src/connectors/adapters/mem.js'

describe('mem adapter manifest', () => {
  it('classifies itself as the doc category and exposes the mem kind', () => {
    expect(memConnector.manifest.kind).toBe('mem')
    expect(memConnector.manifest.category).toBe('doc')
    expect(memConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Mem-specific hint', () => {
    const auth = memConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Mem/i)
  })

  it('covers the mem-create, note-create, and note-delete catalog actions', () => {
    const names = memConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['mem.create', 'notes.create', 'notes.delete'].sort())
    const mutations = memConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['mem.create', 'notes.create', 'notes.delete'].sort())
  })
})
