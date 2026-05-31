import { describe, expect, it } from 'vitest'
import { clickfunnelsConnector } from '../src/connectors/adapters/clickfunnels.js'

describe('clickfunnels adapter manifest', () => {
  it('classifies itself as the crm category and exposes the clickfunnels kind', () => {
    expect(clickfunnelsConnector.manifest.kind).toBe('clickfunnels')
    expect(clickfunnelsConnector.manifest.category).toBe('crm')
    expect(clickfunnelsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = clickfunnelsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, opportunities, tags, courses)', () => {
    const names = clickfunnelsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.search',
        'contacts.create',
        'opportunities.create',
        'tags.apply',
        'tags.remove',
        'courses.enroll',
      ].sort(),
    )
    const reads = clickfunnelsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clickfunnelsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.search'])
    expect(mutations).toEqual(
      [
        'contacts.create',
        'opportunities.create',
        'tags.apply',
        'tags.remove',
        'courses.enroll',
      ].sort(),
    )
  })
})
