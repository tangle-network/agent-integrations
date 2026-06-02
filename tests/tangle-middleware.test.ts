import { describe, expect, it, vi } from 'vitest'
import {
  expressTangleAuthMiddleware,
  extractToken,
  honoTangleAuthMiddleware,
  requireTangleAuth,
  type ExpressLikeRequest,
} from '../src/middleware/index'
import type { TangleIdentityClient } from '../src/connectors/adapters/tangle-id'
import { TangleIdentityUnreachableError } from '../src/connectors/adapters/tangle-id'

function makeClient(verify: TangleIdentityClient['verifyToken']): TangleIdentityClient {
  return {
    verifyToken: verify,
    getUser: vi.fn(),
    listWorkspaces: vi.fn(),
    switchWorkspace: vi.fn(),
    revokeSession: vi.fn(),
    ping: vi.fn(),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    inviteMember: vi.fn(),
    removeMember: vi.fn(),
  }
}

function reqWith(headers: Record<string, string>): Pick<Request, 'headers'> {
  return { headers: new Headers(headers) }
}

describe('extractToken', () => {
  it('reads Bearer token from Authorization header', () => {
    expect(extractToken(reqWith({ authorization: 'Bearer sk-tan-abc' }))).toBe('sk-tan-abc')
  })

  it('drops Authorization values without the Bearer scheme', () => {
    expect(extractToken(reqWith({ authorization: 'Basic dXNlcg==' }))).toBeUndefined()
  })

  it('drops service tokens to prevent service-as-user escalation', () => {
    expect(extractToken(reqWith({ authorization: 'Bearer svc_internal' }))).toBeUndefined()
  })

  it('falls back to the better-auth session cookie', () => {
    const token = extractToken(reqWith({ cookie: 'foo=bar; better-auth.session_token=jwt.value; bar=baz' }))
    expect(token).toBe('jwt.value')
  })

  it('respects a custom cookie name', () => {
    const token = extractToken(reqWith({ cookie: 'tangle_session=opaque' }), 'tangle_session')
    expect(token).toBe('opaque')
  })

  it('preserves cookie value characters (no URL-decoding)', () => {
    const signed = 'sig.eyJhYmMiOiJkZWYifQ==.payload'
    const token = extractToken(reqWith({ cookie: `better-auth.session_token=${signed}` }))
    expect(token).toBe(signed)
  })

  it('returns undefined when neither header nor cookie carries a token', () => {
    expect(extractToken(reqWith({}))).toBeUndefined()
  })
})

describe('requireTangleAuth', () => {
  it('returns 401 missing_credential when no token is supplied (default requireCredential=true)', async () => {
    const client = makeClient(async () => ({ valid: false, reason: 'malformed' }))
    const out = await requireTangleAuth(reqWith({}), { client })
    expect(out).toEqual({ ok: false, status: 401, reason: 'missing_credential' })
  })

  it('returns an anonymous ok when requireCredential=false and no token present', async () => {
    const client = makeClient(async () => ({ valid: false, reason: 'malformed' }))
    const out = await requireTangleAuth(reqWith({}), { client, requireCredential: false })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.auth.userId).toBe('')
  })

  it('attaches full TangleAuthContext on a valid API key result', async () => {
    const client = makeClient(async () => ({
      valid: true,
      kind: 'api_key',
      userId: 'usr_1',
      workspaceId: 'team_1',
      scopes: ['gmail:read'],
      ownerType: 'team',
      credentialId: 'key_1',
      product: 'legal',
      expiresAt: 1_700_000_000_000,
    }))
    const out = await requireTangleAuth(reqWith({ authorization: 'Bearer sk-tan-x' }), { client })
    if (!out.ok) throw new Error('expected ok')
    expect(out.auth).toEqual({
      userId: 'usr_1',
      workspaceId: 'team_1',
      scopes: ['gmail:read'],
      kind: 'api_key',
      ownerType: 'team',
      credentialId: 'key_1',
      product: 'legal',
      expiresAt: 1_700_000_000_000,
    })
  })

  it('maps service_token_refused to 403 (distinct from 401 bad-token)', async () => {
    const client = makeClient(async () => ({ valid: false, reason: 'service_token_refused' }))
    const out = await requireTangleAuth(reqWith({ authorization: 'Bearer sk-tan-x' }), { client })
    expect(out).toEqual({ ok: false, status: 403, reason: 'service_token_refused' })
  })

  it('maps other verify failures to 401', async () => {
    for (const reason of ['expired', 'revoked', 'tampered', 'wrong_issuer', 'malformed'] as const) {
      const client = makeClient(async () => ({ valid: false, reason }))
      const out = await requireTangleAuth(reqWith({ authorization: 'Bearer sk-tan-x' }), { client })
      expect(out).toEqual({ ok: false, status: 401, reason })
    }
  })

  it('maps platform unreachability to 503 platform_unreachable instead of bubbling', async () => {
    const client = makeClient(async () => {
      throw new TangleIdentityUnreachableError('down')
    })
    const out = await requireTangleAuth(reqWith({ authorization: 'Bearer sk-tan-x' }), { client })
    expect(out).toEqual({ ok: false, status: 503, reason: 'platform_unreachable' })
  })

  it('rethrows non-TangleIdentity errors so they surface in upstream error handlers', async () => {
    const client = makeClient(async () => {
      throw new TypeError('coding bug')
    })
    await expect(
      requireTangleAuth(reqWith({ authorization: 'Bearer sk-tan-x' }), { client }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})

describe('honoTangleAuthMiddleware', () => {
  it('short-circuits with a typed 401 envelope on missing credential', async () => {
    const client = makeClient(async () => ({ valid: false, reason: 'malformed' }))
    const handler = honoTangleAuthMiddleware({ client })
    const ctx = { req: { raw: new Request('http://x/y') }, set: vi.fn() }
    const next = vi.fn(async () => {})
    const res = await handler(ctx, next)
    expect(next).not.toHaveBeenCalled()
    expect(res).toBeInstanceOf(Response)
    const body = await (res as Response).json()
    expect((res as Response).status).toBe(401)
    expect(body).toEqual({
      success: false,
      error: { code: 'MISSING_CREDENTIAL', message: 'missing_credential' },
    })
  })

  it('sets tangleAuth on context and calls next on success', async () => {
    const client = makeClient(async () => ({
      valid: true,
      kind: 'session',
      userId: 'u',
      workspaceId: 'u',
      scopes: [],
      ownerType: 'user',
    }))
    const handler = honoTangleAuthMiddleware({ client })
    const set = vi.fn()
    const ctx = {
      req: { raw: new Request('http://x', { headers: { authorization: 'Bearer x' } }) },
      set,
    }
    const next = vi.fn(async () => {})
    const res = await handler(ctx, next)
    expect(res).toBeUndefined()
    expect(next).toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('tangleAuth', expect.objectContaining({ userId: 'u' }))
  })
})

describe('expressTangleAuthMiddleware', () => {
  it('writes a JSON 401 response and does not call next on failure', async () => {
    const client = makeClient(async () => ({ valid: false, reason: 'expired' }))
    const handler = expressTangleAuthMiddleware({ client })
    let body = ''
    let status = 0
    const res = {
      status: vi.fn((code: number) => {
        status = code
        return res
      }),
      setHeader: vi.fn(),
      end: vi.fn((payload: string) => {
        body = payload
      }),
    }
    const next = vi.fn()
    await handler(
      { headers: { authorization: 'Bearer sk-tan-x' } },
      res,
      next,
    )
    expect(next).not.toHaveBeenCalled()
    expect(status).toBe(401)
    expect(JSON.parse(body)).toEqual({
      success: false,
      error: { code: 'EXPIRED', message: 'expired' },
    })
  })

  it('attaches tangleAuth to req and calls next on success', async () => {
    const client = makeClient(async () => ({
      valid: true,
      kind: 'session',
      userId: 'u',
      workspaceId: 'u',
      scopes: [],
      ownerType: 'user',
    }))
    const handler = expressTangleAuthMiddleware({ client })
    const req: ExpressLikeRequest = {
      headers: { authorization: 'Bearer x' },
    }
    const res = { status: vi.fn(), setHeader: vi.fn(), end: vi.fn() }
    const next = vi.fn()
    await handler(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(req.tangleAuth?.userId).toBe('u')
  })
})
