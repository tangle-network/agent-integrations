import { describe, expect, it } from 'vitest'
import { customgptConnector } from '../src/connectors/adapters/customgpt.js'

describe('customgpt adapter manifest', () => {
  it('classifies itself as the other category and exposes the customgpt kind', () => {
    expect(customgptConnector.manifest.kind).toBe('customgpt')
    expect(customgptConnector.manifest.category).toBe('other')
    expect(customgptConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares API-key auth matching the activepieces catalog entry', () => {
    const auth = customgptConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers agent lifecycle, conversation, and message capabilities derived from the actions array', () => {
    const names = customgptConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('agents.create')
    expect(names).toContain('agents.update')
    expect(names).toContain('agents.delete')
    expect(names).toContain('agents.updateSettings')
    expect(names).toContain('conversations.create')
    expect(names).toContain('conversations.sendMessage')
    expect(names).toContain('conversations.find')
    expect(names).toContain('conversations.export')

    const reads = customgptConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = customgptConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toContain('conversations.find')
    expect(mutations).toContain('agents.create')
    expect(mutations).toContain('agents.delete')
    expect(mutations).toContain('conversations.sendMessage')
    expect(mutations).toContain('conversations.export')
  })
})
