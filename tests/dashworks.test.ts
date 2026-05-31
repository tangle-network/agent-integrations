import { describe, expect, it } from 'vitest'
import { dashworksConnector } from '../src/connectors/adapters/dashworks.js'

describe('dashworks adapter manifest', () => {
  it('classifies itself under the other category and exposes the dashworks kind', () => {
    expect(dashworksConnector.manifest.kind).toBe('dashworks')
    expect(dashworksConnector.manifest.category).toBe('other')
    expect(dashworksConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (Dashworks Bots API has no OAuth flow)', () => {
    const auth = dashworksConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the generate.answer capability from the activepieces catalog', () => {
    const names = dashworksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['generate.answer'])
    const ask = dashworksConnector.manifest.capabilities.find((c) => c.name === 'generate.answer')
    if (!ask) throw new Error('generate.answer capability missing')
    expect(ask.class).toBe('mutation')
  })
})
