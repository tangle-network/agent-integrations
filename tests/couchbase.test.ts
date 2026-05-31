import { describe, expect, it } from 'vitest'
import { couchbaseConnector } from '../src/connectors/adapters/couchbase.js'

describe('couchbase adapter manifest', () => {
  it('classifies itself as the database category and exposes the couchbase kind', () => {
    expect(couchbaseConnector.manifest.kind).toBe('couchbase')
    expect(couchbaseConnector.manifest.category).toBe('database')
    expect(couchbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = couchbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (cluster, buckets, documents)', () => {
    const names = couchbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'cluster.info',
        'buckets.list',
        'documents.query',
        'documents.get',
        'documents.create',
        'documents.update',
        'documents.delete',
      ].sort(),
    )
    const reads = couchbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = couchbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['cluster.info', 'buckets.list', 'documents.query', 'documents.get'].sort())
    expect(mutations).toEqual(['documents.create', 'documents.update', 'documents.delete'].sort())
  })
})
