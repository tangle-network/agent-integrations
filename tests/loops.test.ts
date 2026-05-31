import { describe, expect, it } from 'vitest'
import { loopsConnector } from '../src/connectors/adapters/loops.js'

describe('loops adapter manifest', () => {
  it('classifies itself as the comms category and exposes the loops kind', () => {
    expect(loopsConnector.manifest.kind).toBe('loops')
    expect(loopsConnector.manifest.category).toBe('comms')
    expect(loopsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = loopsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contacts, events, and emails', () => {
    const names = loopsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'contacts.create',
      'contacts.delete',
      'contacts.find',
      'emails.sendTransactional',
      'events.send',
    ])
    const mutations = loopsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([
      'contacts.create',
      'contacts.delete',
      'emails.sendTransactional',
      'events.send',
    ])
  })
})
