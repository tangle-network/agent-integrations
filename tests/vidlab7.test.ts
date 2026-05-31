import { describe, expect, it } from 'vitest'
import { vidlab7Connector } from '../src/connectors/adapters/vidlab7.js'

describe('vidlab7 adapter manifest', () => {
  it('classifies itself as the other category and exposes the vidlab7 kind', () => {
    expect(vidlab7Connector.manifest.kind).toBe('vidlab7')
    expect(vidlab7Connector.manifest.category).toBe('other')
    expect(vidlab7Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = vidlab7Connector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (create video)', () => {
    const names = vidlab7Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['videos.create'].sort())
    const mutations = vidlab7Connector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['videos.create'].sort())
  })
})
