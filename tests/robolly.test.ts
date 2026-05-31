import { describe, expect, it } from 'vitest'
import { robollyConnector } from '../src/connectors/adapters/robolly.js'

describe('robolly adapter manifest', () => {
  it('classifies itself as the crm category and exposes the robolly kind', () => {
    expect(robollyConnector.manifest.kind).toBe('robolly')
    expect(robollyConnector.manifest.category).toBe('crm')
    expect(robollyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = robollyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the robolly action set (image generation)', () => {
    const names = robollyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['images.generate'].sort())
    const mutations = robollyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['images.generate'])
  })
})
