import { describe, expect, it } from 'vitest'
import { amazonSqsConnector } from '../src/connectors/adapters/amazon-sqs.js'

describe('amazon-sqs adapter manifest', () => {
  it('exposes the amazon-sqs kind, "other" category, and authoritative consistency', () => {
    expect(amazonSqsConnector.manifest.kind).toBe('amazon-sqs')
    expect(amazonSqsConnector.manifest.category).toBe('other')
    expect(amazonSqsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape; AWS keys signed at the gateway)', () => {
    const auth = amazonSqsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/aws/i)
  })

  it('covers the activepieces send.message action plus receive/delete/queue-discovery primitives', () => {
    const names = amazonSqsConnector.manifest.capabilities.map((c) => c.name).sort()
    // The activepieces catalog only lists send.message; an SQS adapter that
    // omits receive+delete would be unusable for an agent.
    expect(names).toContain('messages.send')
    expect(names).toContain('messages.receive')
    expect(names).toContain('messages.delete')
    expect(names).toContain('queues.list')
    expect(names).toContain('queues.getUrl')
  })

  it('marks receive as non-idempotent (mutates visibility state) and delete as native-idempotency', () => {
    const byName = new Map(amazonSqsConnector.manifest.capabilities.map((c) => [c.name, c]))
    const receive = byName.get('messages.receive')
    const del = byName.get('messages.delete')
    if (!receive || receive.class !== 'mutation' || !del || del.class !== 'mutation') {
      throw new Error('expected mutation capabilities')
    }
    expect(receive.cas).toBe('none')
    expect(receive.externalEffect).toBe(true)
    expect(del.cas).toBe('native-idempotency')
  })
})
