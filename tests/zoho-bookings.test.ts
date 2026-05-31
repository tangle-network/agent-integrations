import { describe, expect, it } from 'vitest'
import { zohoBookingsConnector } from '../src/connectors/adapters/zoho-bookings.js'

describe('zoho-bookings adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the zoho-bookings kind', () => {
    expect(zohoBookingsConnector.manifest.kind).toBe('zoho-bookings')
    expect(zohoBookingsConnector.manifest.category).toBe('calendar')
    expect(zohoBookingsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zohoBookingsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (book, reschedule, cancel, fetch availability, get details)', () => {
    const names = zohoBookingsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'appointment.list',
        'appointment.get',
        'availability.fetch',
        'appointment.book',
        'appointment.reschedule',
        'appointment.cancel',
      ].sort(),
    )
    const reads = zohoBookingsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zohoBookingsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['appointment.list', 'appointment.get', 'availability.fetch'].sort())
    expect(mutations).toEqual(['appointment.book', 'appointment.reschedule', 'appointment.cancel'].sort())
  })
})
