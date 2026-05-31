import { describe, expect, it } from 'vitest'
import { avianConnector } from '../src/connectors/adapters/avian.js'

describe('avian adapter manifest', () => {
  it('classifies itself under the other category and exposes the avian kind', () => {
    expect(avianConnector.manifest.kind).toBe('avian')
    expect(avianConnector.manifest.category).toBe('other')
    expect(avianConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface (Avian uses a Bearer API key, not OAuth)', () => {
    const auth = avianConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the activepieces ask.avian action plus a read-only models.list helper', () => {
    const names = avianConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['ask.avian', 'models.list'])
    const ask = avianConnector.manifest.capabilities.find((c) => c.name === 'ask.avian')
    if (!ask) throw new Error('ask.avian capability missing')
    expect(ask.class).toBe('mutation')
    const models = avianConnector.manifest.capabilities.find((c) => c.name === 'models.list')
    if (!models) throw new Error('models.list capability missing')
    expect(models.class).toBe('read')
  })
})
