import { afterEach, describe, expect, it, vi } from 'vitest'
import { clickupConnector } from '../src/connectors/adapters/clickup.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(credentials: ResolvedDataSource['credentials']): ResolvedDataSource {
  return {
    id: 'src_clickup_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clickup',
    label: 'Tangle ClickUp',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials,
    status: 'active',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clickup adapter manifest', () => {
  it('identifies as clickup with an authoritative consistency model', () => {
    expect(clickupConnector.manifest.kind).toBe('clickup')
    expect(clickupConnector.manifest.category).toBe('other')
    expect(clickupConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('prefers shared OAuth while retaining personal tokens as an option', () => {
    const auth = clickupConnector.manifest.auth
    expect(auth.kind).toBe('one_of')
    if (auth.kind !== 'one_of') throw new Error('unreachable')
    expect(auth.preferred).toBe('oauth2')
    expect(auth.options.map((option) => option.kind)).toEqual(['api-key', 'oauth2'])
    const oauth = auth.options.find((option) => option.kind === 'oauth2')
    if (!oauth || oauth.kind !== 'oauth2') throw new Error('missing OAuth option')
    expect(oauth.authorizationUrl).toBe('https://app.clickup.com/api')
    expect(oauth.tokenUrl).toBe('https://api.clickup.com/api/v2/oauth/token')
    expect(oauth.clientIdEnv).toBe('CLICKUP_OAUTH_CLIENT_ID')
    expect(oauth.clientSecretEnv).toBe('CLICKUP_OAUTH_CLIENT_SECRET')
    // ClickUp's OAuth flow has no named scopes the app can request — consent
    // is per-Workspace at authorize time. We model that as an empty list,
    // not a guess at fake scope names.
    expect(oauth.scopes).toEqual([])
  })

  it.each([
    [{ kind: 'api-key', apiKey: 'pk_clickup' } as const, 'pk_clickup'],
    [{ kind: 'oauth2', accessToken: 'oauth_clickup' } as const, 'Bearer oauth_clickup'],
  ])('uses ClickUp\'s auth-specific Authorization header', async (credentials, expected) => {
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(JSON.stringify({ user: { id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    expect(await clickupConnector.test(source(credentials))).toEqual({ ok: true })
    expect(authorization).toBe(expected)
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
