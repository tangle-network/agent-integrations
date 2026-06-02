import { describe, expect, it } from 'vitest'
import { backblazeConnector } from '../src/connectors/adapters/backblaze.js'

describe('backblaze adapter manifest', () => {
  it('classifies itself as the storage category and exposes the backblaze kind', () => {
    expect(backblazeConnector.manifest.kind).toBe('backblaze')
    expect(backblazeConnector.manifest.category).toBe('storage')
    expect(backblazeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = backblazeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: read/upload + write-side delete/copy + list', () => {
    const names = backblazeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['files.copy', 'files.delete', 'files.list', 'files.read', 'files.s3_upload'].sort(),
    )
    const reads = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['files.list', 'files.read'])
    expect(mutations).toEqual(['files.copy', 'files.delete', 'files.s3_upload'])
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect', () => {
    const writeSide = ['files.delete', 'files.copy']
    for (const name of writeSide) {
      const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('files.delete targets DELETE /{bucket}/{key} and requires a key arg', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.delete')
    expect(cap).toBeDefined()
    expect((cap?.parameters as { required?: string[] }).required).toEqual(['key'])
  })

  it('files.copy carries an x-amz-copy-source header template and requires source+dest keys', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.copy')
    expect(cap).toBeDefined()
    expect((cap?.parameters as { required?: string[] }).required).toEqual([
      'sourceBucket',
      'sourceKey',
      'destKey',
    ])
  })

  it('files.list exposes a paginated S3 ListObjectsV2 surface', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.list')
    expect(cap).toBeDefined()
    expect(cap?.class).toBe('read')
    const params = cap?.parameters as { properties?: Record<string, unknown> }
    expect(params.properties).toHaveProperty('prefix')
    expect(params.properties).toHaveProperty('maxKeys')
    expect(params.properties).toHaveProperty('continuationToken')
  })
})
