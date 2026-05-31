import { describe, expect, it } from 'vitest'
import { openPhoneConnector } from '../src/connectors/adapters/open-phone.js'

describe('open-phone adapter manifest', () => {
  it('classifies itself as the other category and exposes the open-phone kind', () => {
    expect(openPhoneConnector.manifest.kind).toBe('open-phone')
    expect(openPhoneConnector.manifest.category).toBe('other')
    expect(openPhoneConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = openPhoneConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/OpenPhone/i)
  })

  it('covers messages, contacts, and calls capability surface', () => {
    const names = openPhoneConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['calls.summary', 'contacts.create', 'contacts.update', 'messages.send'].sort())
    const mutations = openPhoneConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['contacts.create', 'contacts.update', 'messages.send'].sort())
  })
})
