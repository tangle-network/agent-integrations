import { describe, expect, it } from 'vitest'
import { codyConnector } from '../src/connectors/adapters/cody.js'

describe('cody adapter manifest', () => {
  it('classifies itself as the other category and exposes the cody kind', () => {
    expect(codyConnector.manifest.kind).toBe('cody')
    expect(codyConnector.manifest.category).toBe('other')
    expect(codyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = codyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Cody/i)
  })

  it('covers conversations, messages, documents, and bots capability surface', () => {
    const names = codyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'conversations.create',
        'conversations.find',
        'messages.send',
        'documents.create',
        'documents.upload',
        'bots.find',
      ].sort(),
    )
    const mutations = codyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['conversations.create', 'messages.send', 'documents.create', 'documents.upload'].sort(),
    )
    const reads = codyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['conversations.find', 'bots.find'].sort())
  })
})
