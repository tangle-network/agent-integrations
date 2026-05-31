import { describe, expect, it } from 'vitest'
import { sendinblueConnector } from '../src/connectors/adapters/sendinblue.js'

describe('sendinblue adapter manifest', () => {
  it('classifies itself as the crm category and exposes the sendinblue kind', () => {
    expect(sendinblueConnector.manifest.kind).toBe('sendinblue')
    expect(sendinblueConnector.manifest.category).toBe('crm')
    expect(sendinblueConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = sendinblueConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Sendinblue/i)
  })

  it('covers contacts and lists capability surface', () => {
    const names = sendinblueConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.createOrUpdate',
        'contacts.get',
        'contacts.delete',
        'lists.get',
      ].sort(),
    )
    const mutations = sendinblueConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.createOrUpdate',
        'contacts.delete',
      ].sort(),
    )
  })
})
