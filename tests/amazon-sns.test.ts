import { describe, expect, it } from 'vitest'
import { amazonSnsConnector } from '../src/connectors/adapters/amazon-sns.js'

describe('amazon-sns adapter manifest', () => {
  it('classifies itself as the comms category and exposes the amazon-sns kind', () => {
    expect(amazonSnsConnector.manifest.kind).toBe('amazon-sns')
    expect(amazonSnsConnector.manifest.category).toBe('comms')
    expect(amazonSnsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape which maps AWS SigV4 onto the api-key slot)', () => {
    const auth = amazonSnsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the upstream send.message action plus the supporting topic / subscription surface', () => {
    const names = amazonSnsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'send.message',
        'topics.list',
        'topics.get-attributes',
        'topics.create',
        'topics.delete',
        'subscriptions.list',
        'subscriptions.subscribe',
        'subscriptions.unsubscribe',
      ].sort(),
    )
    const reads = amazonSnsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonSnsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['subscriptions.list', 'topics.get-attributes', 'topics.list'].sort())
    expect(mutations).toEqual(
      [
        'send.message',
        'subscriptions.subscribe',
        'subscriptions.unsubscribe',
        'topics.create',
        'topics.delete',
      ].sort(),
    )
  })
})
