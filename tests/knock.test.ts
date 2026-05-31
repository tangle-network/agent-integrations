import { describe, expect, it } from 'vitest'
import { knockConnector } from '../src/connectors/adapters/knock.js'

describe('knock adapter manifest', () => {
  it('classifies itself as the comms category and exposes the knock kind', () => {
    expect(knockConnector.manifest.kind).toBe('knock')
    expect(knockConnector.manifest.category).toBe('comms')
    expect(knockConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = knockConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (workflows, users, messages)', () => {
    const names = knockConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.trigger',
        'users.identify',
        'users.get',
        'users.delete',
        'messages.get',
        'messages.list',
      ].sort(),
    )
    const reads = knockConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = knockConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['messages.get', 'messages.list', 'users.get'].sort())
    expect(mutations).toEqual(
      ['users.delete', 'users.identify', 'workflows.trigger'].sort(),
    )
  })
})
