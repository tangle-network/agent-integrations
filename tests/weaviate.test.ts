import { describe, expect, it } from 'vitest'
import { weaviateConnector } from '../src/connectors/adapters/weaviate.js'

describe('weaviate adapter manifest', () => {
  it('exposes the weaviate kind, "storage" category, and authoritative consistency', () => {
    expect(weaviateConnector.manifest.kind).toBe('weaviate')
    expect(weaviateConnector.manifest.category).toBe('storage')
    expect(weaviateConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (weaviate cloud / api-key auth module)', () => {
    const auth = weaviateConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers schema, objects, graphql, batch, meta and nodes surfaces', () => {
    const names = weaviateConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'schema.list',
        'schema.get',
        'schema.create',
        'schema.delete',
        'objects.list',
        'objects.get',
        'objects.create',
        'objects.update',
        'objects.replace',
        'objects.delete',
        'graphql.query',
        'batch.objects.create',
        'batch.objects.delete',
        'meta.get',
        'nodes.list',
      ].sort(),
    )
  })

  it('marks schema.create and batch ops as cas="none" (server does not dedupe)', () => {
    const byName = new Map(weaviateConnector.manifest.capabilities.map((c) => [c.name, c]))
    const schemaCreate = byName.get('schema.create')
    const batchCreate = byName.get('batch.objects.create')
    const batchDelete = byName.get('batch.objects.delete')
    const objectsCreate = byName.get('objects.create')
    if (
      !schemaCreate ||
      schemaCreate.class !== 'mutation' ||
      !batchCreate ||
      batchCreate.class !== 'mutation' ||
      !batchDelete ||
      batchDelete.class !== 'mutation' ||
      !objectsCreate ||
      objectsCreate.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(schemaCreate.cas).toBe('none')
    expect(batchCreate.cas).toBe('none')
    expect(batchDelete.cas).toBe('none')
    // deterministic-UUID inserts give native idempotency
    expect(objectsCreate.cas).toBe('native-idempotency')
  })
})
