import { describe, expect, it } from 'vitest'
import { microsoftSharepointConnector } from '../src/connectors/adapters/microsoft-sharepoint.js'

describe('microsoft-sharepoint adapter manifest', () => {
  it('classifies itself as the storage category and exposes the microsoft-sharepoint kind', () => {
    expect(microsoftSharepointConnector.manifest.kind).toBe('microsoft-sharepoint')
    expect(microsoftSharepointConnector.manifest.category).toBe('storage')
    expect(microsoftSharepointConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = microsoftSharepointConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.authorizationUrl).toContain('login.microsoftonline.com')
      expect(auth.tokenUrl).toContain('login.microsoftonline.com')
      expect(auth.scopes).toContain('Sites.ReadWrite.All')
    }
  })

  it('covers the full activepieces action set (sites, folders, files, lists, pages)', () => {
    const names = microsoftSharepointConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.folder',
        'create.list',
        'create.list.item',
        'delete.list.item',
        'find.list.item',
        'update.list.item',
        'upload.file',
        'copy.item',
        'copy.item.within.site',
        'find.file',
        'get.folder.contents',
        'get.site.information',
        'find.site',
        'move.file',
        'publish.page',
      ].sort(),
    )

    const reads = microsoftSharepointConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoftSharepointConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      ['find.file', 'find.list.item', 'find.site', 'get.folder.contents', 'get.site.information'].sort(),
    )
    expect(mutations).toEqual(
      [
        'copy.item',
        'copy.item.within.site',
        'create.folder',
        'create.list',
        'create.list.item',
        'delete.list.item',
        'move.file',
        'publish.page',
        'update.list.item',
        'upload.file',
      ].sort(),
    )
  })
})
