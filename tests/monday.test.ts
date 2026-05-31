import { describe, expect, it } from 'vitest'
import { mondayConnector } from '../src/connectors/adapters/monday.js'

describe('monday adapter manifest', () => {
  it('identifies as the monday kind under the work-management surface', () => {
    expect(mondayConnector.manifest.kind).toBe('monday')
    expect(mondayConnector.manifest.displayName).toBe('monday.com')
    expect(mondayConnector.manifest.category).toBe('other')
    expect(mondayConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against the documented monday auth endpoints with env-var names', () => {
    const auth = mondayConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.monday.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://auth.monday.com/oauth2/token')
    expect(auth.clientIdEnv).toBe('MONDAY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MONDAY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('boards:read')
    expect(auth.scopes).toContain('boards:write')
    expect(auth.scopes).toContain('updates:write')
  })

  it('covers the work-management lifecycle: boards, items, groups, updates', () => {
    const names = mondayConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'me.get',
        'workspaces.list',
        'boards.list',
        'boards.get',
        'items.page',
        'items.get',
        'updates.list',
        'items.create',
        'items.update_columns',
        'items.move_group',
        'items.archive',
        'items.delete',
        'groups.create',
        'updates.create',
      ].sort(),
    )

    const reads = mondayConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mondayConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'me.get',
        'workspaces.list',
        'boards.list',
        'boards.get',
        'items.page',
        'items.get',
        'updates.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'items.create',
        'items.update_columns',
        'items.move_group',
        'items.archive',
        'items.delete',
        'groups.create',
        'updates.create',
      ].sort(),
    )
  })

  it('marks item column-value updates as optimistic-read-verify so callers stage a read first', () => {
    const updateCols = mondayConnector.manifest.capabilities.find((c) => c.name === 'items.update_columns')
    expect(updateCols).toBeDefined()
    if (!updateCols || updateCols.class !== 'mutation') throw new Error('unreachable')
    expect(updateCols.cas).toBe('optimistic-read-verify')
  })
})
