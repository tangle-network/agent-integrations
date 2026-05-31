import { describe, expect, it } from 'vitest'
import { validatedmailsConnector } from '../src/connectors/adapters/validatedmails.js'

describe('validatedmails adapter manifest', () => {
  it('classifies itself as the comms category and exposes the validatedmails kind', () => {
    expect(validatedmailsConnector.manifest.kind).toBe('validatedmails')
    expect(validatedmailsConnector.manifest.category).toBe('comms')
    expect(validatedmailsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = validatedmailsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: validating emails', () => {
    const names = validatedmailsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['email.validate'])
    const mutations = validatedmailsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['email.validate'])
  })
})
