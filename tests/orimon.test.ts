import { describe, expect, it } from 'vitest'
import { orimonConnector } from '../src/connectors/adapters/orimon.js'

describe('orimon adapter manifest', () => {
  it('classifies itself as the comms category and exposes the orimon kind', () => {
    expect(orimonConnector.manifest.kind).toBe('orimon')
    expect(orimonConnector.manifest.category).toBe('comms')
    expect(orimonConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = orimonConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Orimon/i)
  })

  it('covers messages, conversations, and leads capability surface', () => {
    const names = orimonConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'conversations.close',
        'conversations.get',
        'conversations.list',
        'leads.create',
        'messages.send',
      ].sort(),
    )
    const mutations = orimonConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'conversations.close',
        'leads.create',
        'messages.send',
      ].sort(),
    )
  })
})
