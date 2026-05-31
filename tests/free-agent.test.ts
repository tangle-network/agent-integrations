import { describe, expect, it } from 'vitest'
import { freeAgentConnector } from '../src/connectors/adapters/free-agent.js'

describe('free-agent adapter manifest', () => {
  it('classifies itself as the crm category and exposes the free-agent kind', () => {
    expect(freeAgentConnector.manifest.kind).toBe('free-agent')
    expect(freeAgentConnector.manifest.category).toBe('crm')
    expect(freeAgentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = freeAgentConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action set (contacts, tasks) plus read/poll surfaces for invoices and users', () => {
    const names = freeAgentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.create')
    expect(names).toContain('tasks.create')
    expect(names).toContain('invoices.search')
    expect(names).toContain('users.search')

    const mutations = freeAgentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('contacts.create')
    expect(mutations).toContain('tasks.create')
  })
})
