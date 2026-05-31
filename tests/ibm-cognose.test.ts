import { describe, expect, it } from 'vitest'
import { ibmCognoseConnector } from '../src/connectors/adapters/ibm-cognose.js'

describe('ibm-cognose adapter manifest', () => {
  it('classifies itself as the database category and exposes the ibm-cognose kind', () => {
    expect(ibmCognoseConnector.manifest.kind).toBe('ibm-cognose')
    expect(ibmCognoseConnector.manifest.category).toBe('database')
    expect(ibmCognoseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = ibmCognoseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (datasources, objects CRUD)', () => {
    const names = ibmCognoseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'datasources.create',
        'datasources.update',
        'datasources.delete',
        'datasources.get',
        'objects.update',
        'objects.get',
        'objects.move',
        'objects.copy',
      ].sort(),
    )
    const reads = ibmCognoseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = ibmCognoseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['datasources.get', 'objects.get'].sort(),
    )
    expect(mutations).toEqual(
      [
        'datasources.create',
        'datasources.update',
        'datasources.delete',
        'objects.update',
        'objects.move',
        'objects.copy',
      ].sort(),
    )
  })
})
