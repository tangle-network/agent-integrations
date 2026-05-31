import { describe, expect, it } from 'vitest'
import { convertkitConnector } from '../src/connectors/adapters/convertkit.js'

describe('convertkit adapter manifest', () => {
  it('classifies itself as the crm category and exposes the convertkit kind', () => {
    expect(convertkitConnector.manifest.kind).toBe('convertkit')
    expect(convertkitConnector.manifest.category).toBe('crm')
    expect(convertkitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = convertkitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes capabilities spanning the convertkit action surface', () => {
    const names = convertkitConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('subscribers.getByEmail')
    expect(names).toContain('subscribers.update')
    expect(names).toContain('broadcasts.create')
    expect(names).toContain('tags.apply')
    expect(names).toContain('forms.subscribers.add')
    expect(names).toContain('sequences.subscribers.add')
    expect(names).toContain('purchases.create')
    const reads = convertkitConnector.manifest.capabilities.filter((c) => c.class === 'read')
    const mutations = convertkitConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(reads.length).toBeGreaterThan(0)
    expect(mutations.length).toBeGreaterThan(0)
  })
})
