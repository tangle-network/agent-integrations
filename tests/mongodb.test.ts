import { describe, expect, it } from 'vitest'
import { mongodbConnector } from '../src/connectors/adapters/mongodb.js'

describe('mongodb adapter manifest', () => {
  it('classifies itself under the database category and exposes the mongodb kind', () => {
    expect(mongodbConnector.manifest.kind).toBe('mongodb')
    expect(mongodbConnector.manifest.category).toBe('database')
    expect(mongodbConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface', () => {
    const auth = mongodbConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/MongoDB/i)
  })

  it('covers the find, insert, update, replace, delete, and aggregate operations', () => {
    const names = mongodbConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'documents.aggregate',
      'documents.deleteMany',
      'documents.deleteOne',
      'documents.find',
      'documents.findOne',
      'documents.insertMany',
      'documents.insertOne',
      'documents.replaceOne',
      'documents.updateMany',
      'documents.updateOne',
    ])

    const reads = mongodbConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mongodbConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['documents.aggregate', 'documents.find', 'documents.findOne'].sort())
    expect(mutations).toEqual(
      [
        'documents.deleteMany',
        'documents.deleteOne',
        'documents.insertMany',
        'documents.insertOne',
        'documents.replaceOne',
        'documents.updateMany',
        'documents.updateOne',
      ].sort()
    )
  })
})
