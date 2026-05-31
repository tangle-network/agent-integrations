import { describe, expect, it } from 'vitest'
import { alaiConnector } from '../src/connectors/adapters/alai.js'

describe('alai adapter manifest', () => {
  it('classifies itself under the storage category and exposes the alai kind', () => {
    expect(alaiConnector.manifest.kind).toBe('alai')
    expect(alaiConnector.manifest.category).toBe('storage')
    expect(alaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface (Alai has no OAuth flow)', () => {
    const auth = alaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the five activepieces actions: generate, get-generation, export, add-slide, delete', () => {
    const names = alaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'add.slide',
      'delete.presentation',
      'export.presentation',
      'generate.presentation',
      'get.generation',
    ])
    const get = alaiConnector.manifest.capabilities.find((c) => c.name === 'get.generation')
    if (!get) throw new Error('get.generation capability missing')
    expect(get.class).toBe('read')
    const del = alaiConnector.manifest.capabilities.find((c) => c.name === 'delete.presentation')
    if (!del) throw new Error('delete.presentation capability missing')
    expect(del.class).toBe('mutation')
  })
})
