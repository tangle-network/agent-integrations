import { describe, expect, it } from 'vitest'
import { qdrantConnector } from '../src/connectors/adapters/qdrant.js'

describe('qdrant adapter manifest', () => {
  it('exposes the qdrant kind, "other" category, and advisory consistency', () => {
    expect(qdrantConnector.manifest.kind).toBe('qdrant')
    expect(qdrantConnector.manifest.category).toBe('other')
    expect(qdrantConnector.manifest.defaultConsistencyModel).toBe('advisory')
    expect(qdrantConnector.manifest.displayName).toBe('Qdrant')
  })

  it('uses api-key auth (qdrant cloud has no public OAuth surface)', () => {
    const auth = qdrantConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
    expect(auth.hint).toMatch(/qdrant/i)
  })

  it('covers collection lifecycle, point CRUD, search, and snapshots', () => {
    const names = qdrantConnector.manifest.capabilities.map((c) => c.name)

    // Collection lifecycle
    expect(names).toContain('collections.list')
    expect(names).toContain('collections.get')
    expect(names).toContain('collections.exists')
    expect(names).toContain('collections.create')
    expect(names).toContain('collections.update')
    expect(names).toContain('collections.delete')

    // Aliases + indexes
    expect(names).toContain('collections.aliases.list')
    expect(names).toContain('collections.aliases.update')
    expect(names).toContain('collections.index.create')
    expect(names).toContain('collections.index.delete')

    // Point lifecycle
    expect(names).toContain('points.upsert')
    expect(names).toContain('points.get')
    expect(names).toContain('points.delete')
    expect(names).toContain('points.set_payload')
    expect(names).toContain('points.overwrite_payload')
    expect(names).toContain('points.delete_payload')
    expect(names).toContain('points.clear_payload')
    expect(names).toContain('points.update_vectors')
    expect(names).toContain('points.delete_vectors')
    expect(names).toContain('points.batch_update')

    // Search and query
    expect(names).toContain('points.search')
    expect(names).toContain('points.search_batch')
    expect(names).toContain('points.query')
    expect(names).toContain('points.query_batch')
    expect(names).toContain('points.recommend')
    expect(names).toContain('points.scroll')
    expect(names).toContain('points.count')

    // Snapshots + cluster
    expect(names).toContain('snapshots.list')
    expect(names).toContain('snapshots.create')
    expect(names).toContain('snapshots.delete')
    expect(names).toContain('snapshots.list_full')
    expect(names).toContain('cluster.info')
    expect(names).toContain('cluster.collection_info')
  })

  it('marks snapshot creation as cas="none" (server-side timestamped, non-idempotent)', () => {
    const byName = new Map(qdrantConnector.manifest.capabilities.map((c) => [c.name, c]))
    const snapshotCreate = byName.get('snapshots.create')
    const collectionsCreate = byName.get('collections.create')
    const pointsUpsert = byName.get('points.upsert')
    if (
      !snapshotCreate ||
      snapshotCreate.class !== 'mutation' ||
      !collectionsCreate ||
      collectionsCreate.class !== 'mutation' ||
      !pointsUpsert ||
      pointsUpsert.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(snapshotCreate.cas).toBe('none')
    // Collection PUT and point upsert with caller-supplied ids are idempotent.
    expect(collectionsCreate.cas).toBe('native-idempotency')
    expect(pointsUpsert.cas).toBe('native-idempotency')
  })

  it('partitions capabilities into reads and mutations with no overlap', () => {
    const caps = qdrantConnector.manifest.capabilities
    const reads = caps.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = caps.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(new Set([...reads, ...mutations]).size).toBe(caps.length)
    // Search is a read, not a mutation, despite POST verb.
    expect(reads).toContain('points.search')
    expect(reads).toContain('points.query')
    expect(reads).toContain('points.count')
    // Upsert/delete must be mutations.
    expect(mutations).toContain('points.upsert')
    expect(mutations).toContain('points.delete')
    expect(mutations).toContain('collections.delete')
  })
})
