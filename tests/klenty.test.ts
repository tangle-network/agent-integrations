import { describe, expect, it } from 'vitest'
import { klentyConnector } from '../src/connectors/adapters/klenty.js'

describe('klenty adapter manifest', () => {
  it('classifies itself as the crm category and exposes the klenty kind', () => {
    expect(klentyConnector.manifest.kind).toBe('klenty')
    expect(klentyConnector.manifest.category).toBe('crm')
    expect(klentyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = klentyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (get/create/update prospect, add to cadence)', () => {
    const names = klentyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'prospect.get',
        'prospect.create',
        'prospect.update',
        'prospect.add.to.campaign',
      ].sort(),
    )
    const reads = klentyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = klentyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['prospect.get'])
    expect(mutations).toEqual(
      ['prospect.add.to.campaign', 'prospect.create', 'prospect.update'].sort(),
    )
  })
})
