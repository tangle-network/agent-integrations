import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  microsoftTeams,
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_teams_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'microsoft-teams',
    label: 'Acme Workspace',
    consistencyModel: 'advisory',
    scopes: [
      'https://graph.microsoft.com/ChannelMessage.Send',
      'https://graph.microsoft.com/Chat.ReadWrite',
    ],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('microsoft-teams adapter', () => {
  const adapter = microsoftTeams({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest passes the connector validator', () => {
    expect(validateConnectorManifest(adapter.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('manifest exposes the expected chat-pack capability set', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'list_channel_messages',
      'list_joined_teams',
      'list_team_channels',
      'lookup_user',
      'post_channel_message',
      'post_chat_message',
    ])
  })

  it('declares oauth2 auth with v2.0 endpoints and the documented env-var names', () => {
    expect(adapter.manifest.auth).toMatchObject({
      kind: 'oauth2',
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      clientIdEnv: 'MS_OAUTH_CLIENT_ID',
      clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
    })
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.scopes).toContain('offline_access')
      expect(adapter.manifest.auth.scopes).toContain(
        'https://graph.microsoft.com/ChannelMessage.Send',
      )
    }
  })

  it('mutation capabilities are declared cas:none under an advisory consistency model', () => {
    expect(adapter.manifest.defaultConsistencyModel).toBe('advisory')
    for (const cap of adapter.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas, cap.name).toBe('none')
        expect(cap.externalEffect, cap.name).toBe(true)
      }
    }
  })

  it('exposes read + mutation handlers consistent with the manifest', () => {
    const hasReads = adapter.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = adapter.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(adapter.executeRead)).toBe(hasReads)
    expect(Boolean(adapter.executeMutation)).toBe(hasMutations)
  })

  it('post_channel_message POSTs the Graph channel-messages endpoint with html|text body', async () => {
    let calledUrl = ''
    let calledBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        id: '1700000000000',
        webUrl: 'https://teams.microsoft.com/l/message/19:foo/1700000000000',
        createdDateTime: '2025-01-01T00:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'post_channel_message',
      args: {
        teamId: 'team-1',
        channelId: '19:foo@thread.tacv2',
        content: '<p>hello</p>',
        contentType: 'html',
      },
      idempotencyKey: 'k1',
    })

    expect(result.status).toBe('committed')
    expect(calledUrl).toBe(
      'https://graph.microsoft.com/v1.0/teams/team-1/channels/19%3Afoo%40thread.tacv2/messages',
    )
    expect(calledBody).toEqual({ body: { contentType: 'html', content: '<p>hello</p>' } })
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('1700000000000')
    }
  })

  it('post_chat_message defaults contentType to text when omitted', async () => {
    let calledBody: unknown = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'm1', createdDateTime: '2025-01-01T00:00:00Z' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'post_chat_message',
      args: { chatId: '19:abc@thread.v2', content: 'hi there' },
      idempotencyKey: 'k1',
    })

    expect(result.status).toBe('committed')
    expect(calledBody).toEqual({ body: { contentType: 'text', content: 'hi there' } })
  })

  it('list_joined_teams maps Graph values into a teams[] summary', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        value: [
          { id: 't1', displayName: 'Acme', description: 'all-hands' },
          { id: 't2', displayName: 'Eng' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_joined_teams',
      args: {},
      idempotencyKey: 'k1',
    })
    const data = result.data as { teams: Array<{ id: string; displayName?: string }> }
    expect(data.teams).toHaveLength(2)
    expect(data.teams[0]).toMatchObject({ id: 't1', displayName: 'Acme' })
  })

  it('lookup_user OData $filter escapes single quotes and reports not-found cleanly', async () => {
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'lookup_user',
      args: { email: "o'malley@acme.com" },
      idempotencyKey: 'k1',
    })

    expect((result.data as { found: boolean }).found).toBe(false)
    // OData escapes single quote by doubling it: o'malley -> o''malley.
    expect(decodeURIComponent(observedUrl)).toContain("mail eq 'o''malley@acme.com'")
    expect(decodeURIComponent(observedUrl)).toContain("userPrincipalName eq 'o''malley@acme.com'")
  })

  it('post_channel_message maps 401 to CredentialsExpired', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'post_channel_message',
        args: { teamId: 't1', channelId: 'c1', content: 'hi' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('test() returns ok when Graph /me responds 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'u1' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out).toEqual({ ok: true })
  })

  it('test() reports a reconnect reason when Graph rejects the token', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/reconnect required/i)
  })
})
