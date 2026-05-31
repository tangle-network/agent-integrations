import { describe, expect, it } from 'vitest'
import { twinLabsConnector } from '../src/connectors/adapters/twin-labs.js'

describe('twin-labs adapter manifest', () => {
  it('classifies itself as the other category and exposes the twin-labs kind', () => {
    expect(twinLabsConnector.manifest.kind).toBe('twin-labs')
    expect(twinLabsConnector.manifest.category).toBe('other')
    expect(twinLabsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = twinLabsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the browsing task action set', () => {
    const names = twinLabsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['browsing.start'])
    const mutations = twinLabsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['browsing.start'])
  })
})
