import { describe, expect, it } from 'vitest'
import { bitlyConnector } from '../src/connectors/adapters/bitly.js'

describe('bitly adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bitly kind', () => {
    expect(bitlyConnector.manifest.kind).toBe('bitly')
    expect(bitlyConnector.manifest.category).toBe('crm')
    expect(bitlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (Bitly access token, sent as Bearer)', () => {
    const auth = bitlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: bitlink CRUD + archive + qr create', () => {
    const names = bitlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['bitlink.archive', 'bitlink.create', 'bitlink.get', 'bitlink.update', 'qr.create'].sort(),
    )
    const mutations = bitlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['bitlink.archive', 'bitlink.create', 'bitlink.update', 'qr.create'].sort(),
    )
  })
})
