import { describe, expect, it } from 'vitest'
import { cloudinaryConnector } from '../src/connectors/adapters/cloudinary.js'

describe('cloudinary adapter manifest', () => {
  it('classifies itself as the storage category and exposes the cloudinary kind', () => {
    expect(cloudinaryConnector.manifest.kind).toBe('cloudinary')
    expect(cloudinaryConnector.manifest.category).toBe('storage')
    expect(cloudinaryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cloudinaryConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (upload, delete, usage report, find, transform)', () => {
    const names = cloudinaryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'upload.resource',
        'delete.resource',
        'create.usage.report',
        'find.resource.by.public.id',
        'transform.resource',
      ].sort(),
    )
    const reads = cloudinaryConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cloudinaryConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['find.resource.by.public.id'].sort())
    expect(mutations).toEqual(
      ['create.usage.report', 'delete.resource', 'transform.resource', 'upload.resource'].sort(),
    )
  })
})
