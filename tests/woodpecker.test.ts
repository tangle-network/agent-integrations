import { describe, expect, it } from 'vitest'
import { woodpeckerConnector } from '../src/connectors/adapters/woodpecker.js'

describe('woodpecker adapter manifest', () => {
  it('classifies itself as the crm category and exposes the woodpecker kind', () => {
    expect(woodpeckerConnector.manifest.kind).toBe('woodpecker')
    expect(woodpeckerConnector.manifest.category).toBe('crm')
    expect(woodpeckerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = woodpeckerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the main activepieces action set (prospect, domain management)', () => {
    const names = woodpeckerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'domain.blacklist',
        'prospect.add-to-campaign',
        'prospect.add-to-list',
        'prospect.find-by-email',
        'prospect.get-responses',
      ].sort(),
    )
    const reads = woodpeckerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = woodpeckerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['prospect.find-by-email', 'prospect.get-responses'].sort())
    expect(mutations).toEqual(
      ['domain.blacklist', 'prospect.add-to-campaign', 'prospect.add-to-list'].sort(),
    )
  })
})
