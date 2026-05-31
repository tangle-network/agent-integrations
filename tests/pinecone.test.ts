import { describe, expect, it } from 'vitest'
import { pineconeConnector } from '../src/connectors/adapters/pinecone.js'

describe('pinecone adapter manifest', () => {
  it('identifies as kind=pinecone, category=other, authoritative consistency', () => {
    expect(pineconeConnector.manifest.kind).toBe('pinecone')
    expect(pineconeConnector.manifest.category).toBe('other')
    expect(pineconeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(pineconeConnector.manifest.displayName).toBe('Pinecone')
  })

  it('uses api-key auth (Pinecone exposes no 3-legged OAuth)', () => {
    const auth = pineconeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    // Hint must point the operator at the right console + flag the per-project key scope.
    expect(auth.hint).toMatch(/pcsk_/)
    expect(auth.hint).toMatch(/indexHost/)
  })

  it('exposes control-plane index, collection, vector-data, and assistant capabilities', () => {
    const names = pineconeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'indexes.list',
        'indexes.describe',
        'indexes.create',
        'indexes.configure',
        'indexes.delete',
        'collections.list',
        'collections.describe',
        'collections.create',
        'collections.delete',
        'vectors.upsert',
        'vectors.query',
        'vectors.fetch',
        'vectors.update',
        'vectors.delete',
        'vectors.list',
        'vectors.describe_index_stats',
        'assistants.list',
        'assistants.describe',
        'assistants.create',
        'assistants.delete',
        'assistants.chat',
      ].sort(),
    )
  })

  it('marks vectors.query and indexes.list as reads, upsert/delete/chat as mutations', () => {
    const byName = new Map(pineconeConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('vectors.query')?.class).toBe('read')
    expect(byName.get('indexes.list')?.class).toBe('read')
    expect(byName.get('vectors.upsert')?.class).toBe('mutation')
    expect(byName.get('vectors.delete')?.class).toBe('mutation')
    expect(byName.get('assistants.chat')?.class).toBe('mutation')
  })

  it('marks generation (assistants.chat) as cas=none, idempotent ops as native-idempotency', () => {
    const byName = new Map(pineconeConnector.manifest.capabilities.map((c) => [c.name, c]))
    const chat = byName.get('assistants.chat')
    const upsert = byName.get('vectors.upsert')
    const indexCreate = byName.get('indexes.create')
    if (chat?.class !== 'mutation') throw new Error('assistants.chat must be a mutation')
    if (upsert?.class !== 'mutation') throw new Error('vectors.upsert must be a mutation')
    if (indexCreate?.class !== 'mutation') throw new Error('indexes.create must be a mutation')
    expect(chat.cas).toBe('none')
    expect(upsert.cas).toBe('native-idempotency')
    expect(indexCreate.cas).toBe('native-idempotency')
  })
})
