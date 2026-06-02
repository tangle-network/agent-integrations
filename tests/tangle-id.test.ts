import { describe, expect, it, vi } from 'vitest'
import {
  createTangleIdentityClient,
  DEFAULT_TANGLE_PLATFORM_URL,
  TANGLE_API_KEY_PREFIX,
  TANGLE_SERVICE_TOKEN_PREFIX,
  tangleIdentity,
  TangleIdentityUnreachableError,
} from '../src/connectors/adapters/tangle-id'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyResponse(status: number): Response {
  // The Fetch spec rejects body for 204/304; pass `null` body for those.
  const nullBodyStatus = status === 204 || status === 304 || status === 205
  return new Response(nullBodyStatus ? null : '', { status })
}

describe('tangle-id verifyToken', () => {
  it('refuses service tokens without making a network call (privilege escalation guard)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const result = await client.verifyToken(`${TANGLE_SERVICE_TOKEN_PREFIX}abc`)
    expect(result).toEqual({ valid: false, reason: 'service_token_refused' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('routes sk-tan-* keys to /v1/keys/verify and returns normalized scopes + team workspace', async () => {
    let capturedPath = ''
    let capturedAuth = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedAuth = (init?.headers as Record<string, string>)['authorization'] ?? ''
      return jsonResponse({
        valid: true,
        userId: 'usr_1',
        ownerId: 'team_1',
        ownerType: 'team',
        keyId: 'key_42',
        product: 'legal',
        allowedModels: ['gpt-4', 'claude-3'],
        expiresAt: '2026-12-31T00:00:00.000Z',
      })
    })
    const client = createTangleIdentityClient({
      baseUrl: 'https://id.example.com',
      serviceToken: 'svc_service',
      fetchImpl,
    })
    const result = await client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)
    expect(capturedPath).toBe('https://id.example.com/v1/keys/verify')
    expect(capturedAuth).toBe('Bearer svc_service')
    expect(result).toMatchObject({
      valid: true,
      kind: 'api_key',
      userId: 'usr_1',
      workspaceId: 'team_1',
      ownerType: 'team',
      credentialId: 'key_42',
      product: 'legal',
    })
    if (result.valid) {
      expect(result.scopes).toEqual(['gpt-4', 'claude-3', 'product:legal'])
      expect(result.expiresAt).toBe(Date.parse('2026-12-31T00:00:00.000Z'))
    }
  })

  it('falls back to userId workspace for personal (non-team) API keys', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ valid: true, userId: 'usr_5', allowedModels: [] }),
    )
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const result = await client.verifyToken(`${TANGLE_API_KEY_PREFIX}x`)
    if (!result.valid) throw new Error('expected valid')
    expect(result.workspaceId).toBe('usr_5')
    expect(result.ownerType).toBe('user')
  })

  it('returns service_token_refused on 401 from /v1/keys/verify', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const result = await client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)
    expect(result).toEqual({ valid: false, reason: 'service_token_refused' })
  })

  it('throws TangleIdentityUnreachableError on 5xx from /v1/keys/verify (fail-closed for platform)', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)).rejects.toBeInstanceOf(
      TangleIdentityUnreachableError,
    )
  })

  it('returns malformed when /v1/keys/verify response has no valid field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    expect(await client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)).toEqual({
      valid: false,
      reason: 'malformed',
    })
  })

  it('returns revoked for valid:false on /v1/keys/verify', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ valid: false }))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    expect(await client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)).toEqual({
      valid: false,
      reason: 'revoked',
    })
  })

  it('routes session bearers to /api/auth/get-session and hydrates the activeTeamId workspace', async () => {
    let capturedPath = ''
    let capturedAuth = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedAuth = (init?.headers as Record<string, string>)['authorization'] ?? ''
      return jsonResponse({
        user: { id: 'usr_9', email: 'a@b.c' },
        session: { id: 'sess_42', expiresAt: '2026-06-01T00:00:00.000Z', activeTeamId: 'team_99' },
      })
    })
    const client = createTangleIdentityClient({
      baseUrl: 'https://id.example.com',
      fetchImpl,
    })
    const result = await client.verifyToken('opaque-session-jwt')
    expect(capturedPath).toBe('https://id.example.com/api/auth/get-session')
    expect(capturedAuth).toBe('Bearer opaque-session-jwt')
    if (!result.valid) throw new Error('expected valid session')
    expect(result.kind).toBe('session')
    expect(result.workspaceId).toBe('team_99')
    expect(result.ownerType).toBe('team')
    expect(result.credentialId).toBe('sess_42')
  })

  it('maps session 401/403 to expired without throwing', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ fetchImpl })
    expect(await client.verifyToken('garbage')).toEqual({ valid: false, reason: 'expired' })
  })

  it('rejects empty token as malformed', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(200))
    const client = createTangleIdentityClient({ fetchImpl })
    expect(await client.verifyToken('')).toEqual({ valid: false, reason: 'malformed' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces network failure as TangleIdentityUnreachableError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('econnrefused')
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.verifyToken(`${TANGLE_API_KEY_PREFIX}token`)).rejects.toBeInstanceOf(
      TangleIdentityUnreachableError,
    )
  })
})

describe('tangle-id listWorkspaces / switchWorkspace', () => {
  it('marks the workspace whose id equals userId as personal even if the platform omits the flag', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          { id: 'usr_1', name: 'Personal', role: 'owner', scopes: ['tangle:*'] },
          { id: 'team_2', name: 'Team', role: 'admin', isPersonal: false, scopes: ['gmail:*'] },
        ],
      }),
    )
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const workspaces = await client.listWorkspaces('usr_1')
    expect(workspaces).toHaveLength(2)
    expect(workspaces[0]).toEqual({
      id: 'usr_1',
      name: 'Personal',
      role: 'owner',
      isPersonal: true,
      scopes: ['tangle:*'],
    })
    expect(workspaces[1]).toMatchObject({ id: 'team_2', role: 'admin', isPersonal: false })
  })

  it('coerces unknown roles to member to avoid leaking platform-only roles', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: [{ id: 'team_x', name: 'X', role: 'superadmin' }] }),
    )
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const [ws] = await client.listWorkspaces('usr_x')
    expect(ws.role).toBe('member')
  })

  it('switchWorkspace returns the matched workspace scopes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          { id: 'team_a', name: 'A', role: 'owner', scopes: ['gmail:*'] },
          { id: 'team_b', name: 'B', role: 'admin', scopes: ['stripe:*'] },
        ],
      }),
    )
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const out = await client.switchWorkspace('usr_x', 'team_b')
    expect(out).toEqual({ ok: true, workspaceId: 'team_b', scopes: ['stripe:*'] })
  })

  it('switchWorkspace throws on missing workspace', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.switchWorkspace('u', 'w')).rejects.toBeInstanceOf(
      TangleIdentityUnreachableError,
    )
  })
})

describe('tangle-id revokeSession', () => {
  it('refuses to revoke service tokens', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(200))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.revokeSession('svc_foo')).rejects.toBeInstanceOf(
      TangleIdentityUnreachableError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('verifies the API key, then DELETEs /v1/keys/{credentialId}', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      if (String(input).endsWith('/v1/keys/verify')) {
        return jsonResponse({ valid: true, userId: 'u1', keyId: 'key_77' })
      }
      return emptyResponse(204)
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await client.revokeSession(`${TANGLE_API_KEY_PREFIX}token`)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE'])
    expect(calls[1].url).toContain('/v1/keys/key_77')
  })

  it('treats 404 on key delete as a successful no-op (idempotent revoke)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/keys/verify')) {
        return jsonResponse({ valid: true, userId: 'u1', keyId: 'key_77' })
      }
      return emptyResponse(404)
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.revokeSession(`${TANGLE_API_KEY_PREFIX}token`)).resolves.toBeUndefined()
  })

  it('POSTs /api/auth/sign-out for session bearers and tolerates 401', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ fetchImpl })
    await expect(client.revokeSession('opaque-jwt')).resolves.toBeUndefined()
  })
})

describe('tangle-id adapter wiring', () => {
  it('exposes the platform-contract capabilities including workspace/member write paths', () => {
    const adapter = tangleIdentity({ serviceToken: 'svc_x' })
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'get_user',
        'list_workspaces',
        'members.invite',
        'members.remove',
        'revoke_session',
        'switch_workspace',
        'verify_token',
        'workspaces.create',
        'workspaces.delete',
      ].sort(),
    )
  })

  it('manifest declares native-idempotency for every mutation capability', () => {
    const adapter = tangleIdentity({ serviceToken: 'svc_x' })
    const mutationNames = adapter.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutationNames).toEqual(
      [
        'members.invite',
        'members.remove',
        'revoke_session',
        'switch_workspace',
        'workspaces.create',
        'workspaces.delete',
      ].sort(),
    )
    for (const cap of adapter.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBe('native-idempotency')
      }
    }
  })

  it('newly added mutations declare externalEffect: true (real upstream side effects)', () => {
    const adapter = tangleIdentity({ serviceToken: 'svc_x' })
    const targets = new Set([
      'workspaces.create',
      'workspaces.delete',
      'members.invite',
      'members.remove',
    ])
    for (const cap of adapter.manifest.capabilities) {
      if (cap.class === 'mutation' && targets.has(cap.name)) {
        expect(cap.externalEffect).toBe(true)
      }
    }
  })

  it('executeRead routes verify_token to the client and round-trips the typed result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ valid: true, userId: 'u', allowedModels: ['gpt-4'] }),
    )
    const adapter = tangleIdentity({ serviceToken: 'svc_x', fetchImpl })
    const result = await adapter.executeRead!({
      source: makeSource(),
      capabilityName: 'verify_token',
      args: { token: `${TANGLE_API_KEY_PREFIX}t` },
      idempotencyKey: 'k',
    })
    expect((result.data as { valid: boolean }).valid).toBe(true)
  })

  it('rejects unknown capability with a descriptive error', async () => {
    const adapter = tangleIdentity({ serviceToken: 'svc_x' })
    await expect(
      adapter.executeRead!({
        source: makeSource(),
        capabilityName: 'totally_unknown',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/unknown read capability/)
  })

  it('exports stable defaults consumers depend on', () => {
    expect(DEFAULT_TANGLE_PLATFORM_URL).toBe('https://id.tangle.tools')
    expect(TANGLE_API_KEY_PREFIX).toBe('sk-tan-')
    expect(TANGLE_SERVICE_TOKEN_PREFIX).toBe('svc_')
  })
})

function makeSource() {
  return {
    id: 'src_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'tangle-id',
    label: 'Tangle Identity',
    consistencyModel: 'authoritative' as const,
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key' as const, apiKey: 'svc_x' },
    status: 'active' as const,
  }
}

describe('tangle-id createWorkspace', () => {
  it('POSTs to /v1/teams with the calling userId and returns the normalized row', async () => {
    let capturedPath = ''
    let capturedMethod = ''
    let capturedBody = ''
    let capturedUserHeader = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body ? String(init.body) : ''
      capturedUserHeader =
        (init?.headers as Record<string, string>)['x-platform-user-id'] ?? ''
      return jsonResponse({
        success: true,
        data: {
          id: 'team_new',
          name: 'New Team',
          role: 'owner',
          isPersonal: false,
          scopes: ['gmail:*'],
        },
      })
    })
    const client = createTangleIdentityClient({
      baseUrl: 'https://id.example.com',
      serviceToken: 'svc_x',
      fetchImpl,
    })
    const workspace = await client.createWorkspace('usr_1', { name: 'New Team' })
    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toBe('https://id.example.com/v1/teams')
    expect(capturedUserHeader).toBe('usr_1')
    expect(capturedBody).toContain('New Team')
    expect(workspace).toEqual({
      id: 'team_new',
      name: 'New Team',
      role: 'owner',
      isPersonal: false,
      scopes: ['gmail:*'],
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.createWorkspace('usr_1', { name: 'X' })).rejects.toMatchObject({
      name: 'CredentialsExpired',
    })
  })

  it('throws on malformed response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.createWorkspace('usr_1', { name: 'X' })).rejects.toBeInstanceOf(
      TangleIdentityUnreachableError,
    )
  })
})

describe('tangle-id deleteWorkspace', () => {
  it('DELETEs /v1/teams/{id} and accepts 204', async () => {
    let capturedPath = ''
    let capturedMethod = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedMethod = init?.method ?? 'GET'
      return emptyResponse(204)
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await client.deleteWorkspace('team_42')
    expect(capturedMethod).toBe('DELETE')
    expect(capturedPath).toContain('/v1/teams/team_42')
  })

  it('treats 404 as an idempotent no-op', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(404))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.deleteWorkspace('team_missing')).resolves.toBeUndefined()
  })

  it('surfaces CredentialsExpired on 401', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.deleteWorkspace('team_1')).rejects.toMatchObject({
      name: 'CredentialsExpired',
    })
  })
})

describe('tangle-id inviteMember', () => {
  it('POSTs to /v1/teams/{id}/invitations and normalizes status + role', async () => {
    let capturedPath = ''
    let capturedMethod = ''
    let capturedBody = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body ? String(init.body) : ''
      return jsonResponse({
        success: true,
        data: {
          id: 'inv_1',
          workspaceId: 'team_1',
          email: 'alice@example.com',
          role: 'admin',
          status: 'pending',
        },
      })
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const invitation = await client.inviteMember('team_1', 'alice@example.com', 'admin')
    expect(capturedMethod).toBe('POST')
    expect(capturedPath).toContain('/v1/teams/team_1/invitations')
    expect(capturedBody).toContain('alice@example.com')
    expect(invitation).toEqual({
      id: 'inv_1',
      workspaceId: 'team_1',
      email: 'alice@example.com',
      role: 'admin',
      status: 'pending',
    })
  })

  it('coerces unknown roles back to member', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          id: 'inv_2',
          workspaceId: 'team_1',
          email: 'b@example.com',
          role: 'superadmin',
          status: 'weird',
        },
      }),
    )
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    const invitation = await client.inviteMember('team_1', 'b@example.com')
    expect(invitation.role).toBe('member')
    expect(invitation.status).toBe('pending')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(
      client.inviteMember('team_1', 'a@b.c'),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('tangle-id removeMember', () => {
  it('DELETEs /v1/teams/{wid}/members/{uid}', async () => {
    let capturedPath = ''
    let capturedMethod = ''
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedPath = String(input)
      capturedMethod = init?.method ?? 'GET'
      return emptyResponse(204)
    })
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await client.removeMember('team_1', 'usr_5')
    expect(capturedMethod).toBe('DELETE')
    expect(capturedPath).toContain('/v1/teams/team_1/members/usr_5')
  })

  it('treats 404 as an idempotent no-op', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(404))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.removeMember('team_1', 'usr_5')).resolves.toBeUndefined()
  })

  it('surfaces CredentialsExpired on 401', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(401))
    const client = createTangleIdentityClient({ serviceToken: 'svc_x', fetchImpl })
    await expect(client.removeMember('team_1', 'usr_5')).rejects.toMatchObject({
      name: 'CredentialsExpired',
    })
  })
})

describe('tangle-id adapter executeMutation routing', () => {
  it('routes workspaces.create through the client and returns committed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { id: 'team_x', name: 'X', role: 'owner', scopes: [] },
      }),
    )
    const adapter = tangleIdentity({ serviceToken: 'svc_x', fetchImpl })
    const result = await adapter.executeMutation!({
      source: makeSource(),
      capabilityName: 'workspaces.create',
      args: { userId: 'usr_1', name: 'X' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
    expect((result as { data: { id: string } }).data.id).toBe('team_x')
  })

  it('routes workspaces.delete through the client and returns ok', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(204))
    const adapter = tangleIdentity({ serviceToken: 'svc_x', fetchImpl })
    const result = await adapter.executeMutation!({
      source: makeSource(),
      capabilityName: 'workspaces.delete',
      args: { workspaceId: 'team_1' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
  })

  it('routes members.invite through the client and returns the invitation row', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          id: 'inv_1',
          workspaceId: 'team_1',
          email: 'a@b.c',
          role: 'member',
          status: 'pending',
        },
      }),
    )
    const adapter = tangleIdentity({ serviceToken: 'svc_x', fetchImpl })
    const result = await adapter.executeMutation!({
      source: makeSource(),
      capabilityName: 'members.invite',
      args: { workspaceId: 'team_1', email: 'a@b.c' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
    expect((result as { data: { id: string } }).data.id).toBe('inv_1')
  })

  it('routes members.remove through the client', async () => {
    const fetchImpl = vi.fn(async () => emptyResponse(204))
    const adapter = tangleIdentity({ serviceToken: 'svc_x', fetchImpl })
    const result = await adapter.executeMutation!({
      source: makeSource(),
      capabilityName: 'members.remove',
      args: { workspaceId: 'team_1', userId: 'usr_5' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
  })

  it('rejects unknown mutation capability', async () => {
    const adapter = tangleIdentity({ serviceToken: 'svc_x' })
    await expect(
      adapter.executeMutation!({
        source: makeSource(),
        capabilityName: 'totally_unknown',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/unknown mutation capability/)
  })
})
