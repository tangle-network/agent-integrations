import { describe, expect, it } from 'vitest'
import { flipandoConnector } from '../src/connectors/adapters/flipando.js'

describe('flipando adapter manifest', () => {
  it('classifies itself under the other category and exposes the flipando kind', () => {
    expect(flipandoConnector.manifest.kind).toBe('flipando')
    expect(flipandoConnector.manifest.category).toBe('other')
    expect(flipandoConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (Flipando has no OAuth flow)', () => {
    const auth = flipandoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Flipando/i)
  })

  it('covers the run/generate/list/poll surface from the activepieces catalog', () => {
    const names = flipandoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['apps.generate', 'apps.list', 'apps.run', 'tasks.get'].sort())

    const reads = flipandoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = flipandoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['apps.list', 'tasks.get'].sort())
    expect(mutations).toEqual(['apps.generate', 'apps.run'].sort())
  })
})
