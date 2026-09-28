import { describe, expect, it } from 'vitest'
import { amazonSqsConnector } from '../src/connectors/adapters/amazon-sqs.js'

describe('amazon-sqs adapter manifest', () => {
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
