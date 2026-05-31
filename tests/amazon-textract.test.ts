import { describe, expect, it } from 'vitest'
import { amazonTextractConnector } from '../src/connectors/adapters/amazon-textract.js'

describe('amazon-textract adapter manifest', () => {
  it('exposes the amazon-textract kind, "other" category, and authoritative consistency', () => {
    expect(amazonTextractConnector.manifest.kind).toBe('amazon-textract')
    expect(amazonTextractConnector.manifest.category).toBe('other')
    expect(amazonTextractConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape; AWS SigV4 happens at the gateway)', () => {
    const auth = amazonTextractConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/aws/i)
  })

  it('covers the five catalog actions plus the async-results read path', () => {
    const names = amazonTextractConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'document.analyze',
        'document.text.detect',
        'expense.analyze',
        'id.analyze',
        'document.analyze.async.start',
        'document.analyze.async.get',
      ].sort(),
    )
    const reads = amazonTextractConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonTextractConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'document.analyze',
        'document.text.detect',
        'expense.analyze',
        'id.analyze',
        'document.analyze.async.get',
      ].sort(),
    )
    expect(mutations).toEqual(['document.analyze.async.start'])
  })

  it('declares ClientRequestToken-backed native idempotency on the async-start mutation', () => {
    const byName = new Map(
      amazonTextractConnector.manifest.capabilities.map((c) => [c.name, c]),
    )
    const asyncStart = byName.get('document.analyze.async.start')
    if (!asyncStart || asyncStart.class !== 'mutation') {
      throw new Error('expected document.analyze.async.start to be a mutation capability')
    }
    expect(asyncStart.cas).toBe('native-idempotency')
  })
})
