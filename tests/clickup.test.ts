import { describe, expect, it } from 'vitest'
import { clickupConnector } from '../src/connectors/adapters/clickup.js'

describe('clickup adapter manifest', () => {
  it('identifies as clickup with an authoritative consistency model', () => {
    expect(clickupConnector.manifest.kind).toBe('clickup')
    expect(clickupConnector.manifest.category).toBe('other')
    expect(clickupConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against ClickUp documented endpoints and env-var names', () => {
    const auth = clickupConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.clickup.com/api')
    expect(auth.tokenUrl).toBe('https://api.clickup.com/api/v2/oauth/token')
    expect(auth.clientIdEnv).toBe('CLICKUP_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('CLICKUP_OAUTH_CLIENT_SECRET')
    // ClickUp's OAuth flow has no named scopes the app can request — consent
    // is per-Workspace at authorize time. We model that as an empty list,
    // not a guess at fake scope names.
    expect(auth.scopes).toEqual([])
  })

  it('covers the workspace hierarchy plus task + comment + time-entry CRUD', () => {
    const names = clickupConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'user.get',
        'teams.list',
        'spaces.list',
        'spaces.get',
        'folders.list',
        'lists.list',
        'lists.folderless',
        'lists.get',
        'tasks.list',
        'tasks.get',
        'tasks.search',
        'tasks.create',
        'tasks.update',
        'tasks.delete',
        'tasks.setCustomField',
        'comments.list',
        'comments.create',
        'timeEntries.list',
        'timeEntries.create',
      ].sort(),
    )

    const reads = clickupConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clickupConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'comments.list',
        'folders.list',
        'lists.folderless',
        'lists.get',
        'lists.list',
        'spaces.get',
        'spaces.list',
        'tasks.get',
        'tasks.list',
        'tasks.search',
        'teams.list',
        'timeEntries.list',
        'user.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'comments.create',
        'tasks.create',
        'tasks.delete',
        'tasks.setCustomField',
        'tasks.update',
        'timeEntries.create',
      ].sort(),
    )
  })
})
