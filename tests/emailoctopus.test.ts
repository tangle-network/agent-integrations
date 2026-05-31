import { describe, expect, it } from 'vitest'
import { emailoctopusConnector } from '../src/connectors/adapters/emailoctopus.js'

describe('emailoctopus adapter manifest', () => {
  it('classifies itself as the crm category and exposes the emailoctopus kind', () => {
    expect(emailoctopusConnector.manifest.kind).toBe('emailoctopus')
    expect(emailoctopusConnector.manifest.category).toBe('crm')
    expect(emailoctopusConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = emailoctopusConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, tags, lists)', () => {
    const names = emailoctopusConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.addOrUpdate',
        'contacts.unsubscribe',
        'contacts.updateEmail',
        'contacts.addTag',
        'contacts.removeTag',
        'lists.create',
        'contacts.find',
      ].sort(),
    )
    const reads = emailoctopusConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = emailoctopusConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find'].sort())
    expect(mutations).toEqual(
      [
        'contacts.addOrUpdate',
        'contacts.addTag',
        'contacts.removeTag',
        'contacts.unsubscribe',
        'contacts.updateEmail',
        'lists.create',
      ].sort(),
    )
  })
})
