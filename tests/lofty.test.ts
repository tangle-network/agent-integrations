import { describe, expect, it } from 'vitest'
import { loftyConnector } from '../src/connectors/adapters/lofty.js'

describe('lofty adapter manifest', () => {
  it('classifies itself as the crm category and exposes the lofty kind', () => {
    expect(loftyConnector.manifest.kind).toBe('lofty')
    expect(loftyConnector.manifest.category).toBe('crm')
    expect(loftyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = loftyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (leads and transactions)', () => {
    const names = loftyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'leads.create',
        'leads.update',
        'transactions.create',
        'transactions.update',
      ].sort(),
    )
    const reads = loftyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = loftyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      ['leads.create', 'leads.update', 'transactions.create', 'transactions.update'].sort(),
    )
  })
})
