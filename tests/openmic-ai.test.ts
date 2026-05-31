import { describe, expect, it } from 'vitest'
import { openmicAiConnector } from '../src/connectors/adapters/openmic-ai.js'

describe('openmic-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the openmic-ai kind', () => {
    expect(openmicAiConnector.manifest.kind).toBe('openmic-ai')
    expect(openmicAiConnector.manifest.category).toBe('comms')
    expect(openmicAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = openmicAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/OpenMic/i)
  })

  it('covers phone calls, bots, and calls capability surface', () => {
    const names = openmicAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.create',
        'bots.list',
        'bots.find',
        'calls.list',
        'calls.find',
      ].sort(),
    )
    const mutations = openmicAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['calls.create'].sort())
  })
})
