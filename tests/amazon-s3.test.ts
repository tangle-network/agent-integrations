import { describe, expect, it } from 'vitest'
import { amazonS3Connector } from '../src/connectors/adapters/amazon-s3.js'

describe('amazon-s3 adapter manifest', () => {
  it('classifies itself as the storage category and exposes the amazon-s3 kind', () => {
    expect(amazonS3Connector.manifest.kind).toBe('amazon-s3')
    expect(amazonS3Connector.manifest.category).toBe('storage')
    expect(amazonS3Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = amazonS3Connector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AWS|Access Key/i)
  })

  it('covers the file management capability surface', () => {
    const names = amazonS3Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.list',
        'files.read',
        'files.upload',
        'files.delete',
        'files.generateSignedUrl',
        'files.moveFile',
      ].sort(),
    )
    const mutations = amazonS3Connector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['files.upload', 'files.delete', 'files.moveFile'].sort(),
    )
  })
})
