import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  jiraCloudConnector,
  validateConnectorManifest,
  type ConnectorInvocation,
  type ResolvedDataSource,
} from '../src/connectors/index.js'
import {
  getIntegrationSpec,
  resolveConnectorAuthSpec,
} from '../src/specs/index.js'

const source: ResolvedDataSource = {
  id: 'src_jira',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'jira-cloud',
  label: 'Acme Jira',
  consistencyModel: 'authoritative',
  scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('jira-cloud adapter manifest', () => {
  it('exposes the Jira Cloud connector and passes manifest validation', () => {
    expect(jiraCloudConnector.manifest.kind).toBe('jira-cloud')
    expect(jiraCloudConnector.manifest.displayName).toBe('Jira Cloud')
    expect(jiraCloudConnector.manifest.category).toBe('doc')
    expect(jiraCloudConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(validateConnectorManifest(jiraCloudConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('uses Atlassian 3LO with the shared app, refresh access, and gateway audience', () => {
    const auth = jiraCloudConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.atlassian.com/authorize')
    expect(auth.tokenUrl).toBe('https://auth.atlassian.com/oauth/token')
    expect(auth.clientIdEnv).toBe('ATLASSIAN_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ATLASSIAN_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual([
      'offline_access',
      'read:jira-work',
      'write:jira-work',
      'read:jira-user',
    ])
    expect(auth.extraAuthParams).toEqual({
      audience: 'api.atlassian.com',
      prompt: 'consent',
    })

    expect(resolveConnectorAuthSpec('jira-cloud')).toMatchObject({
      authKind: 'oauth2',
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      clientIdEnv: 'ATLASSIAN_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ATLASSIAN_OAUTH_CLIENT_SECRET',
      requestedScopes: auth.scopes,
      extraAuthParams: auth.extraAuthParams,
    })
    expect(getIntegrationSpec('jira-cloud')?.setup.credentialFields).toHaveLength(2)
  })

  it('covers site discovery, issues, comments, attachments, and users', () => {
    const names = jiraCloudConnector.manifest.capabilities.map((capability) => capability.name).sort()
    expect(names).toEqual(
      [
        'resources.list',
        'issues.create',
        'issues.search',
        'issues.get',
        'issues.update',
        'issues.assign',
        'issues.transition',
        'issues.link',
        'issues.watchers.add',
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'attachments.get',
        'users.find',
      ].sort(),
    )
  })

  it('assigns the minimum classic Jira scope to every site-scoped action', () => {
    const scopes = Object.fromEntries(
      jiraCloudConnector.manifest.capabilities.map((capability) => [
        capability.name,
        capability.requiredScopes ?? [],
      ]),
    )
    expect(scopes['resources.list']).toEqual([])
    for (const name of ['issues.search', 'issues.get', 'comments.list', 'attachments.get']) {
      expect(scopes[name], name).toEqual(['read:jira-work'])
    }
    for (const name of [
      'issues.create',
      'issues.update',
      'issues.assign',
      'issues.transition',
      'issues.link',
      'issues.watchers.add',
      'comments.create',
      'comments.update',
      'comments.delete',
    ]) {
      expect(scopes[name], name).toEqual(['write:jira-work'])
    }
    expect(scopes['users.find']).toEqual(['read:jira-user'])
  })
})

describe('jira-cloud OAuth execution', () => {
  it('discovers authorized Atlassian sites before a cloudId-scoped action', async () => {
    const resources = [{ id: 'cloud_abc', url: 'https://acme.atlassian.net', name: 'Acme' }]
    const fetchMock = mockFetch(resources)

    const result = await jiraCloudConnector.executeRead!({
      source,
      capabilityName: 'resources.list',
      args: {},
      idempotencyKey: 'idem_resources',
    })

    expect(result.data).toEqual(resources)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/oauth/token/accessible-resources')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token_xyz')
  })

  it('routes issue reads through the Atlassian gateway and encodes site and issue ids', async () => {
    const fetchMock = mockFetch({ id: 'issue_1', key: 'PROJ-1' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'issues.get',
      args: { cloudId: 'cloud/site', issueIdOrKey: 'PROJ/1', fields: 'summary,status' },
      idempotencyKey: 'idem_read',
    }

    const result = await jiraCloudConnector.executeRead!(invocation)

    expect(result.data).toEqual({ id: 'issue_1', key: 'PROJ-1' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain(
      'https://api.atlassian.com/ex/jira/cloud%2Fsite/rest/api/3/issue/PROJ%2F1',
    )
    expect(String(url)).toContain('fields=summary%2Cstatus')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token_xyz')
  })

  it('omits cloudId and absent optional values from issue-create bodies', async () => {
    const fetchMock = mockFetch({ id: 'issue_2', key: 'PROJ-2' }, 201)
    const fields = {
      project: { key: 'PROJ' },
      summary: 'OAuth issue',
      issuetype: { name: 'Task' },
    }

    const result = await jiraCloudConnector.executeMutation!({
      source,
      capabilityName: 'issues.create',
      args: { cloudId: 'cloud_abc', fields },
      idempotencyKey: 'idem_create',
    })

    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/ex/jira/cloud_abc/rest/api/3/issue')
    expect(JSON.parse(String(init.body))).toEqual({ fields })
  })

  it('fails before network access when a site-scoped action omits cloudId', async () => {
    const fetchMock = mockFetch({})
    await expect(
      jiraCloudConnector.executeRead!({
        source,
        capabilityName: 'issues.get',
        args: { issueIdOrKey: 'PROJ-1' },
        idempotencyKey: 'idem_missing_site',
      }),
    ).rejects.toThrow('cloudId')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
