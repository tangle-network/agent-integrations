import { describe, expect, it } from 'vitest'
import { logrocketConnector } from '../src/connectors/adapters/logrocket.js'

describe('logrocket adapter manifest', () => {
  it('exposes the logrocket kind and falls back to the other UI category', () => {
    expect(logrocketConnector.manifest.kind).toBe('logrocket')
    // Catalog category is `workflow`, which is not in the UI-grouping union;
    // `other` is the canonical fallback used by the rest of the workflow pieces.
    expect(logrocketConnector.manifest.category).toBe('other')
    expect(logrocketConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece-logrocket auth shape)', () => {
    const auth = logrocketConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus a poll-style readback of the highlights trigger', () => {
    const names = logrocketConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['highlights.ready', 'highlights.request', 'users.identify'].sort())

    const reads = logrocketConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = logrocketConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['highlights.ready'])
    expect(mutations).toEqual(['highlights.request', 'users.identify'].sort())
  })
})
