import { describe, expect, it } from 'vitest'
import { insightoAiConnector } from '../src/connectors/adapters/insighto-ai.js'

describe('insighto-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the insighto-ai kind', () => {
    expect(insightoAiConnector.manifest.kind).toBe('insighto-ai')
    expect(insightoAiConnector.manifest.category).toBe('comms')
    expect(insightoAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = insightoAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Insighto/i)
  })

  it('covers text blob, contact, call, and campaign capability surface', () => {
    const names = insightoAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['calls.create', 'campaigns.create', 'contacts.upsert', 'textblobs.add'].sort())
    const mutations = insightoAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['calls.create', 'campaigns.create', 'contacts.upsert', 'textblobs.add'].sort())
  })
})
