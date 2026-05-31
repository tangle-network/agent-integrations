import { describe, expect, it } from 'vitest'
import { pocketbaseConnector } from '../src/connectors/adapters/pocketbase.js'

describe('pocketbase adapter manifest', () => {
  it('classifies itself as the database category and exposes the pocketbase kind', () => {
    expect(pocketbaseConnector.manifest.kind).toBe('pocketbase')
    expect(pocketbaseConnector.manifest.category).toBe('database')
    expect(pocketbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = pocketbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/PocketBase/i)
  })

  it('covers list, fullList, get, create, update, and delete record capability surfaces', () => {
    const names = pocketbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.list',
        'records.fullList',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
      ].sort(),
    )
    const mutations = pocketbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['records.create', 'records.update', 'records.delete'].sort())
  })
})
