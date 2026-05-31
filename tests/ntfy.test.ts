import { describe, expect, it } from 'vitest'
import { ntfyConnector } from '../src/connectors/adapters/ntfy.js'

describe('ntfy adapter manifest', () => {
  it('classifies itself as the comms category and exposes the ntfy kind', () => {
    expect(ntfyConnector.manifest.kind).toBe('ntfy')
    expect(ntfyConnector.manifest.category).toBe('comms')
    expect(ntfyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = ntfyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/ntfy|server/i)
  })

  it('covers the send.notification capability', () => {
    const names = ntfyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.notification'])
    const mutations = ntfyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.notification'])
  })
})
