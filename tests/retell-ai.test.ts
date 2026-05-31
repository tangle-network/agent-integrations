import { describe, expect, it } from 'vitest'
import { retellAiConnector } from '../src/connectors/adapters/retell-ai.js'

describe('retell-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the retell-ai kind', () => {
    expect(retellAiConnector.manifest.kind).toBe('retell-ai')
    expect(retellAiConnector.manifest.category).toBe('comms')
    expect(retellAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = retellAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Retell/i)
  })

  it('covers calls, phone numbers, agents, and voices capability surface', () => {
    const names = retellAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.get',
        'calls.get',
        'calls.make',
        'phonenumbers.create',
        'phonenumbers.get',
        'voices.get',
        'voices.list',
      ].sort(),
    )
    const mutations = retellAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['calls.make', 'phonenumbers.create'].sort())
  })
})
