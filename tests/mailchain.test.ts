import { describe, expect, it } from 'vitest'
import { mailchainConnector } from '../src/connectors/adapters/mailchain.js'

describe('mailchain adapter manifest', () => {
  it('classifies itself as the comms category and exposes the mailchain kind', () => {
    expect(mailchainConnector.manifest.kind).toBe('mailchain')
    expect(mailchainConnector.manifest.category).toBe('comms')
    expect(mailchainConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = mailchainConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Mailchain/i)
  })

  it('covers the user and email capability surface', () => {
    const names = mailchainConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['user.get', 'email.send'].sort())

    const mutations = mailchainConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['email.send'].sort())
  })
})
