import { describe, expect, it } from 'vitest'
import { mailerLiteConnector } from '../src/connectors/adapters/mailer-lite.js'

describe('mailer-lite adapter manifest', () => {
  it('classifies itself as the crm category and exposes the mailer-lite kind', () => {
    expect(mailerLiteConnector.manifest.kind).toBe('mailer-lite')
    expect(mailerLiteConnector.manifest.category).toBe('crm')
    expect(mailerLiteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mailerLiteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (subscriber upsert, group add/remove, find)', () => {
    const names = mailerLiteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.upsert',
        'subscribers.groups.add',
        'subscribers.groups.remove',
        'subscribers.find',
      ].sort(),
    )
    const reads = mailerLiteConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mailerLiteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['subscribers.find'])
    expect(mutations).toEqual(
      ['subscribers.groups.add', 'subscribers.groups.remove', 'subscribers.upsert'].sort(),
    )
  })
})
