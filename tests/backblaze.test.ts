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

  it('covers the catalog action set: read file and s3 upload', () => {
    const names = backblazeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['files.read', 'files.s3_upload'].sort())
    const reads = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['files.read'])
    expect(mutations).toEqual(['files.s3_upload'])
  })
})
