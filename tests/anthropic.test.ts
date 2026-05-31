import { describe, expect, it } from 'vitest'
import { anthropicConnector } from '../src/connectors/adapters/anthropic.js'

describe('anthropic adapter manifest', () => {
  it('exposes the anthropic kind, "other" category, and advisory consistency', () => {
    expect(anthropicConnector.manifest.kind).toBe('anthropic')
    expect(anthropicConnector.manifest.category).toBe('other')
    expect(anthropicConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (anthropic has no public OAuth surface)', () => {
    const auth = anthropicConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers messages, count_tokens, models, batches, and files metadata', () => {
    const names = anthropicConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'messages.create',
        'messages.count_tokens',
        'models.list',
        'models.get',
        'batches.create',
        'batches.list',
        'batches.get',
        'batches.results',
        'batches.cancel',
        'batches.delete',
        'files.list',
        'files.get',
        'files.delete',
      ].sort(),
    )
    const reads = anthropicConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = anthropicConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'batches.get',
        'batches.list',
        'batches.results',
        'files.get',
        'files.list',
        'messages.count_tokens',
        'models.get',
        'models.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'batches.cancel',
        'batches.create',
        'batches.delete',
        'files.delete',
        'messages.create',
      ].sort(),
    )
  })

  it('marks generation as cas="none" (non-idempotent) and batch lifecycle as native-idempotency', () => {
    const byName = new Map(anthropicConnector.manifest.capabilities.map((c) => [c.name, c]))
    const messagesCreate = byName.get('messages.create')
    const batchesCreate = byName.get('batches.create')
    const batchesCancel = byName.get('batches.cancel')
    const batchesDelete = byName.get('batches.delete')
    if (
      !messagesCreate ||
      messagesCreate.class !== 'mutation' ||
      !batchesCreate ||
      batchesCreate.class !== 'mutation' ||
      !batchesCancel ||
      batchesCancel.class !== 'mutation' ||
      !batchesDelete ||
      batchesDelete.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(messagesCreate.cas).toBe('none')
    expect(batchesCreate.cas).toBe('none')
    expect(batchesCancel.cas).toBe('native-idempotency')
    expect(batchesDelete.cas).toBe('native-idempotency')
  })
})
