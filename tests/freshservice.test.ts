import { describe, expect, it } from 'vitest'
import { freshserviceConnector } from '../src/connectors/adapters/freshservice.js'

describe('freshservice adapter manifest', () => {
  it('classifies itself as the crm category and exposes the freshservice kind', () => {
    expect(freshserviceConnector.manifest.kind).toBe('freshservice')
    expect(freshserviceConnector.manifest.category).toBe('crm')
    expect(freshserviceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a setup hint that mentions the API key', () => {
    const auth = freshserviceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/API key/i)
  })

  it('covers the four activepieces actions plus read paths for tickets and requesters', () => {
    const names = freshserviceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.list',
        'tickets.get',
        'tickets.create',
        'tickets.note',
        'tickets.requestApproval',
        'requesters.list',
        'requesters.create',
      ].sort(),
    )

    const reads = freshserviceConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = freshserviceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['requesters.list', 'tickets.get', 'tickets.list'])
    expect(mutations).toEqual(
      ['requesters.create', 'tickets.create', 'tickets.note', 'tickets.requestApproval'].sort(),
    )
  })

  it('marks every mutation with a CAS strategy (defaults to native-idempotency)', () => {
    for (const cap of freshserviceConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })
})
