import { describe, expect, it } from 'vitest'
import { blandAiConnector } from '../src/connectors/adapters/bland-ai.js'

describe('bland-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the bland-ai kind', () => {
    expect(blandAiConnector.manifest.kind).toBe('bland-ai')
    expect(blandAiConnector.manifest.category).toBe('comms')
    expect(blandAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = blandAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send call, get call details, list calls', () => {
    const names = blandAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['calls.get', 'calls.list', 'calls.send'])
    const reads = blandAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = blandAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['calls.get', 'calls.list'])
    expect(mutations).toEqual(['calls.send'])
  })
})
