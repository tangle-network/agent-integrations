import { describe, expect, it } from 'vitest'
import { lettaConnector } from '../src/connectors/adapters/letta.js'

describe('letta adapter manifest', () => {
  it('classifies itself as the other category and exposes the letta kind', () => {
    expect(lettaConnector.manifest.kind).toBe('letta')
    expect(lettaConnector.manifest.category).toBe('other')
    expect(lettaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = lettaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Letta/i)
  })

  it('covers agents and identities capability surface', () => {
    const names = lettaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.create-from-template',
        'agents.list',
        'agents.get',
        'agents.send-message',
        'identities.create',
        'identities.list',
        'identities.get',
      ].sort(),
    )
    const mutations = lettaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['agents.create-from-template', 'agents.send-message', 'identities.create'].sort(),
    )
  })
})
