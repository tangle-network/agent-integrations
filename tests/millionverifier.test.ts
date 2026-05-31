import { describe, expect, it } from 'vitest'
import { millionverifierConnector } from '../src/connectors/adapters/millionverifier.js'

describe('millionverifier adapter manifest', () => {
  it('classifies itself as the comms category and exposes the millionverifier kind', () => {
    expect(millionverifierConnector.manifest.kind).toBe('millionverifier')
    expect(millionverifierConnector.manifest.category).toBe('comms')
    expect(millionverifierConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = millionverifierConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: verifyEmail', () => {
    const names = millionverifierConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['verify.email'])
    const reads = millionverifierConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = millionverifierConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['verify.email'])
    expect(mutations).toEqual([])
  })
})
