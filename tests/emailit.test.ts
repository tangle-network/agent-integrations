import { describe, expect, it } from 'vitest'
import { emailitConnector } from '../src/connectors/adapters/emailit.js'

describe('emailit adapter manifest', () => {
  it('classifies itself as the comms category and exposes the emailit kind', () => {
    expect(emailitConnector.manifest.kind).toBe('emailit')
    expect(emailitConnector.manifest.category).toBe('comms')
    expect(emailitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = emailitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.email', () => {
    const names = emailitConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.email'])
    const mutations = emailitConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.email'])
  })
})
