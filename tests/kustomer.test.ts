import { describe, expect, it } from 'vitest'
import { kustomerConnector } from '../src/connectors/adapters/kustomer.js'

describe('kustomer adapter manifest', () => {
  it('classifies itself as the crm category and exposes the kustomer kind', () => {
    expect(kustomerConnector.manifest.kind).toBe('kustomer')
    expect(kustomerConnector.manifest.category).toBe('crm')
    expect(kustomerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = kustomerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (customers, conversations, custom objects)', () => {
    const names = kustomerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.get',
        'customers.search',
        'conversations.create',
        'conversations.get',
        'conversations.update',
        'customObjects.get',
        'customObjects.create',
      ].sort(),
    )
    const reads = kustomerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kustomerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.get', 'customers.search', 'conversations.get', 'customObjects.get'].sort())
    expect(mutations).toEqual(
      ['customers.create', 'conversations.create', 'conversations.update', 'customObjects.create'].sort(),
    )
  })
})
