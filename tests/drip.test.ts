import { describe, expect, it } from 'vitest'
import { dripConnector } from '../src/connectors/adapters/drip.js'

describe('drip adapter manifest', () => {
  it('classifies itself as the crm category and exposes the drip kind', () => {
    expect(dripConnector.manifest.kind).toBe('drip')
    expect(dripConnector.manifest.category).toBe('crm')
    expect(dripConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = dripConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (add to campaign, apply tag, upsert subscriber)', () => {
    const names = dripConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.add_to_campaign',
        'subscribers.apply_tag',
        'subscribers.upsert',
      ].sort(),
    )
    const reads = dripConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = dripConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      ['subscribers.add_to_campaign', 'subscribers.apply_tag', 'subscribers.upsert'].sort(),
    )
  })
})
