import { describe, expect, it } from 'vitest'
import { zohoDeskConnector } from '../src/connectors/adapters/zoho-desk.js'

describe('zoho-desk adapter manifest', () => {
  it('classifies itself as the crm category and exposes the zoho-desk kind', () => {
    expect(zohoDeskConnector.manifest.kind).toBe('zoho-desk')
    expect(zohoDeskConnector.manifest.category).toBe('crm')
    expect(zohoDeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zohoDeskConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (list tickets, search, get, create, update, find contacts)', () => {
    const names = zohoDeskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.list',
        'tickets.search',
        'tickets.get',
        'tickets.create',
        'tickets.update',
        'contacts.find',
      ].sort(),
    )
    const reads = zohoDeskConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zohoDeskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['tickets.list', 'tickets.search', 'tickets.get', 'contacts.find'].sort())
    expect(mutations).toEqual(['tickets.create', 'tickets.update'].sort())
  })
})
