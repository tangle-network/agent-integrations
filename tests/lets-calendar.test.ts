import { describe, expect, it } from 'vitest'
import { letsCalendarConnector } from '../src/connectors/adapters/lets-calendar.js'

describe('lets-calendar adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the lets-calendar kind', () => {
    expect(letsCalendarConnector.manifest.kind).toBe('lets-calendar')
    expect(letsCalendarConnector.manifest.category).toBe('calendar')
    expect(letsCalendarConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = letsCalendarConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces add-contact-to-campaign action plus campaign reads', () => {
    const names = letsCalendarConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['contacts.add.to.campaign', 'campaigns.get', 'campaigns.list'].sort(),
    )
    const mutations = letsCalendarConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['contacts.add.to.campaign'])
    const reads = letsCalendarConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['campaigns.get', 'campaigns.list'].sort())
  })
})
