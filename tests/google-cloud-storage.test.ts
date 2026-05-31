import { describe, expect, it } from 'vitest'
import { googleCloudStorageConnector } from '../src/connectors/adapters/google-cloud-storage.js'

describe('google-cloud-storage adapter manifest', () => {
  it('classifies itself as the storage category and exposes the google-cloud-storage kind', () => {
    expect(googleCloudStorageConnector.manifest.kind).toBe('google-cloud-storage')
    expect(googleCloudStorageConnector.manifest.category).toBe('storage')
    expect(googleCloudStorageConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as the catalog says', () => {
    const auth = googleCloudStorageConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: buckets, objects, and ACLs', () => {
    const names = googleCloudStorageConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'buckets.create',
        'buckets.delete_empty',
        'buckets.search',
        'bucket_acl.create',
        'bucket_acl.delete',
        'bucket_default_object_acl.create',
        'bucket_default_object_acl.delete',
        'object_acl.create',
        'object_acl.delete',
        'objects.clone',
        'objects.delete',
        'objects.search',
      ].sort(),
    )
    const reads = googleCloudStorageConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googleCloudStorageConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['buckets.search', 'objects.search'])
    expect(mutations).toEqual(
      [
        'buckets.create',
        'buckets.delete_empty',
        'bucket_acl.create',
        'bucket_acl.delete',
        'bucket_default_object_acl.create',
        'bucket_default_object_acl.delete',
        'object_acl.create',
        'object_acl.delete',
        'objects.clone',
        'objects.delete',
      ].sort(),
    )
  })
})
