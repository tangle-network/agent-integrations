import { describe, expect, it } from 'vitest'
import { lobstermailConnector } from '../src/connectors/adapters/lobstermail.js'

describe('lobstermail adapter manifest', () => {
  it('classifies itself as the comms category and exposes the lobstermail kind', () => {
    expect(lobstermailConnector.manifest.kind).toBe('lobstermail')
    expect(lobstermailConnector.manifest.category).toBe('comms')
    expect(lobstermailConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = lobstermailConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: account + inbox lifecycle + email send/list/get/search', () => {
    const names = lobstermailConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.get',
        'emails.get',
        'emails.list',
        'emails.search',
        'emails.send',
        'inboxes.create',
        'inboxes.delete',
        'inboxes.get',
        'inboxes.list',
      ].sort(),
    )
    const reads = lobstermailConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = lobstermailConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['account.get', 'emails.get', 'emails.list', 'emails.search', 'inboxes.get', 'inboxes.list'].sort(),
    )
    expect(mutations).toEqual(['emails.send', 'inboxes.create', 'inboxes.delete'].sort())
  })
})
