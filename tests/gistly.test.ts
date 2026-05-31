import { describe, expect, it } from 'vitest'
import { gistlyConnector } from '../src/connectors/adapters/gistly.js'

describe('gistly adapter manifest', () => {
  it('classifies itself as the other category and exposes the gistly kind', () => {
    expect(gistlyConnector.manifest.kind).toBe('gistly')
    // Activepieces catalog category is `workflow`, which the connector
    // manifest does not enumerate — we land it in `other`.
    expect(gistlyConnector.manifest.category).toBe('other')
    expect(gistlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = gistlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (get transcript)', () => {
    const names = gistlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['transcripts.get'].sort())
    const reads = gistlyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = gistlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['transcripts.get'])
    expect(mutations).toEqual([])
  })
})
