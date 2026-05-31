import { describe, expect, it } from 'vitest'
import { guideliteConnector } from '../src/connectors/adapters/guidelite.js'

describe('guidelite adapter manifest', () => {
  it('classifies itself as the other category and exposes the guidelite kind', () => {
    expect(guideliteConnector.manifest.kind).toBe('guidelite')
    expect(guideliteConnector.manifest.category).toBe('other')
    expect(guideliteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares API-key auth matching the activepieces catalog entry', () => {
    const auth = guideliteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the sendAPrompt action plus lead/conversation polling reads', () => {
    const names = guideliteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('assistant.sendPrompt')
    expect(names).toContain('leads.list.recent')
    expect(names).toContain('conversations.list.recent')

    const mutations = guideliteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toContain('assistant.sendPrompt')

    const reads = guideliteConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('leads.list.recent')
    expect(reads).toContain('conversations.list.recent')
  })
})
