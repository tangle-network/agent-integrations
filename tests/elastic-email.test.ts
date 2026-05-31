import { describe, expect, it } from 'vitest'
import { elasticEmailConnector } from '../src/connectors/adapters/elastic-email.js'

describe('elastic-email adapter manifest', () => {
  it('classifies itself as the crm category and exposes the elastic-email kind', () => {
    expect(elasticEmailConnector.manifest.kind).toBe('elastic-email')
    expect(elasticEmailConnector.manifest.category).toBe('crm')
    expect(elasticEmailConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = elasticEmailConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contacts + segments + campaigns + email', () => {
    const names = elasticEmailConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.add',
        'contacts.create',
        'contacts.list',
        'contacts.unsubscribe',
        'contacts.update',
        'segments.create',
        'campaigns.create',
        'campaigns.list',
        'campaigns.update',
        'email.send',
      ].sort(),
    )
    const reads = elasticEmailConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = elasticEmailConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['campaigns.list', 'contacts.list'])
    expect(mutations).toEqual(
      [
        'campaigns.create',
        'campaigns.update',
        'contacts.add',
        'contacts.create',
        'contacts.unsubscribe',
        'contacts.update',
        'email.send',
        'segments.create',
      ].sort(),
    )
  })
})
