import { describe, expect, it } from 'vitest'
import { microsoftOnedriveConnector } from '../src/connectors/adapters/microsoft-onedrive.js'

describe('microsoft-onedrive adapter manifest', () => {
  it('classifies itself as the storage category and exposes the microsoft-onedrive kind', () => {
    expect(microsoftOnedriveConnector.manifest.kind).toBe('microsoft-onedrive')
    expect(microsoftOnedriveConnector.manifest.category).toBe('storage')
    expect(microsoftOnedriveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = microsoftOnedriveConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: list/download/upload files and list folders', () => {
    const names = microsoftOnedriveConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['files.download', 'files.list', 'files.upload', 'folders.list'])
    const mutations = microsoftOnedriveConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['files.upload'])
  })
})
