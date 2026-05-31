import { describe, expect, it } from 'vitest'
import { helpscoutConnector } from '../src/connectors/adapters/helpscout.js'

describe('helpscout adapter manifest', () => {
  it('classifies itself as the crm category and exposes the helpscout kind', () => {
    expect(helpscoutConnector.manifest.kind).toBe('helpscout')
    expect(helpscoutConnector.manifest.category).toBe('crm')
    expect(helpscoutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth with Help Scout endpoints', () => {
    const auth = helpscoutConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/secure\.helpscout\.net/)
    expect(auth.tokenUrl).toMatch(/api\.helpscout\.net/)
  })

  it('covers the full Help Scout action set (search, read, reply, update)', () => {
    const names = helpscoutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.search',
        'tickets.read',
        'customers.read',
        'tickets.reply',
        'tickets.update',
      ].sort(),
    )
    const reads = helpscoutConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = helpscoutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.read', 'tickets.read', 'tickets.search'].sort())
    expect(mutations).toEqual(['tickets.reply', 'tickets.update'].sort())
  })
})
