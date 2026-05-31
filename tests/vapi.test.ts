import { describe, expect, it } from 'vitest'
import { vapiConnector } from '../src/connectors/adapters/vapi.js'

describe('vapi adapter manifest', () => {
  it('classifies itself as the comms category and exposes the vapi kind', () => {
    expect(vapiConnector.manifest.kind).toBe('vapi')
    expect(vapiConnector.manifest.category).toBe('comms')
    expect(vapiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = vapiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Vapi/i)
  })

  it('covers the calls and assistants capability surface', () => {
    const names = vapiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['assistants.update', 'calls.create', 'calls.get'].sort())
    const mutations = vapiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['assistants.update', 'calls.create'].sort())
  })
})
