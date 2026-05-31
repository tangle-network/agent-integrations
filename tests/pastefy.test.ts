import { describe, expect, it } from 'vitest'
import { pastefyConnector } from '../src/connectors/adapters/pastefy.js'

describe('pastefy adapter manifest', () => {
  it('classifies itself as the other category and exposes the pastefy kind', () => {
    expect(pastefyConnector.manifest.kind).toBe('pastefy')
    expect(pastefyConnector.manifest.category).toBe('other')
    expect(pastefyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = pastefyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the pastefy action set (list, get, create, delete)', () => {
    const names = pastefyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'pastes.list',
        'pastes.get',
        'pastes.create',
        'pastes.delete',
      ].sort(),
    )
    const reads = pastefyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = pastefyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['pastes.get', 'pastes.list'].sort())
    expect(mutations).toEqual(['pastes.create', 'pastes.delete'].sort())
  })
})
