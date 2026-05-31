import { describe, expect, it } from 'vitest'
import { agentxConnector } from '../src/connectors/adapters/agentx.js'

describe('agentx adapter manifest', () => {
  it('classifies itself as the other category and exposes the agentx kind', () => {
    expect(agentxConnector.manifest.kind).toBe('agentx')
    expect(agentxConnector.manifest.category).toBe('other')
    expect(agentxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares API-key auth matching the activepieces catalog entry', () => {
    const auth = agentxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers conversation creation, messaging, and search capabilities derived from the actions array', () => {
    const names = agentxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('conversations.createWithSingleAgent')
    expect(names).toContain('conversations.sendMessage')
    expect(names).toContain('messages.find')
    expect(names).toContain('agents.search')
    expect(names).toContain('conversations.find')

    const reads = agentxConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = agentxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toContain('messages.find')
    expect(reads).toContain('agents.search')
    expect(reads).toContain('conversations.find')
    expect(mutations).toEqual(
      ['conversations.createWithSingleAgent', 'conversations.sendMessage'].sort(),
    )
  })
})
