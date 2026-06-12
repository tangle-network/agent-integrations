import { describe, expect, it } from 'vitest'
import {
  mintDelegatedToolToken,
  verifyDelegatedToolToken,
} from '../token.js'
import { issueDelegatedToolLease } from '../lease.js'
import {
  handleDelegatedToolCall,
  handleDelegatedToolRequest,
  DelegatedToolInvocationError,
  type DelegatedToolCallSeams,
  type ResolvedDelegatedTool,
} from '../handler.js'

const SECRET = 'test-delegated-secret'
const WORKSPACE = 'ws_123'

describe('mint/verify token', () => {
  it('round-trips claims', async () => {
    const token = await mintDelegatedToolToken({
      workspaceId: WORKSPACE,
      allowedTools: ['gcal__events.create', 'slack__post'],
      ttlSeconds: 600,
      secret: SECRET,
    })
    expect(token).toBeDefined()
    expect(token!.startsWith('dtt_')).toBe(true)

    const claims = await verifyDelegatedToolToken(token!, { secret: SECRET })
    expect(claims).not.toBeNull()
    expect(claims!.workspaceId).toBe(WORKSPACE)
    expect(claims!.allowedTools).toEqual(['gcal__events.create', 'slack__post'])
    expect(claims!.expiresAt).toBeGreaterThan(Date.now())
  })

  it('honors a custom prefix', async () => {
    const token = await mintDelegatedToolToken({
      workspaceId: WORKSPACE,
      allowedTools: ['a'],
      ttlSeconds: 60,
      secret: SECRET,
      prefix: 'gtmmcp_',
    })
    expect(token!.startsWith('gtmmcp_')).toBe(true)
    // default-prefix verify rejects a custom-prefix token
    expect(await verifyDelegatedToolToken(token!, { secret: SECRET })).toBeNull()
    expect(await verifyDelegatedToolToken(token!, { secret: SECRET, prefix: 'gtmmcp_' })).not.toBeNull()
  })

  it('fail-closed: no secret ⇒ no token', async () => {
    expect(await mintDelegatedToolToken({ workspaceId: WORKSPACE, allowedTools: [], ttlSeconds: 60 })).toBeUndefined()
    expect(await mintDelegatedToolToken({ workspaceId: WORKSPACE, allowedTools: [], ttlSeconds: 60, secret: '  ' })).toBeUndefined()
  })

  it('rejects an expired token', async () => {
    const t0 = 1_000_000_000_000
    const token = await mintDelegatedToolToken({
      workspaceId: WORKSPACE,
      allowedTools: ['x'],
      ttlSeconds: 60,
      secret: SECRET,
      now: t0,
    })
    expect(await verifyDelegatedToolToken(token!, { secret: SECRET, now: t0 + 59_000 })).not.toBeNull()
    expect(await verifyDelegatedToolToken(token!, { secret: SECRET, now: t0 + 60_001 })).toBeNull()
  })

  it('rejects a forged signature', async () => {
    const token = await mintDelegatedToolToken({
      workspaceId: WORKSPACE,
      allowedTools: ['x'],
      ttlSeconds: 60,
      secret: SECRET,
    })
    // tamper with the signature segment
    const tampered = token!.slice(0, -2) + (token!.endsWith('AA') ? 'BB' : 'AA')
    expect(await verifyDelegatedToolToken(tampered, { secret: SECRET })).toBeNull()
    // wrong secret rejects
    expect(await verifyDelegatedToolToken(token!, { secret: 'other-secret' })).toBeNull()
  })

  it('rejects a tampered claims payload (privilege escalation attempt)', async () => {
    const token = await mintDelegatedToolToken({
      workspaceId: WORKSPACE,
      allowedTools: ['read'],
      ttlSeconds: 60,
      secret: SECRET,
    })
    const [, sig] = token!.slice('dtt_'.length).split('.')
    const forgedClaims = Buffer.from(
      JSON.stringify({ workspaceId: WORKSPACE, allowedTools: ['admin.delete'], expiresAt: Date.now() + 60_000 }),
    )
      .toString('base64url')
    const forged = `dtt_${forgedClaims}.${sig}`
    expect(await verifyDelegatedToolToken(forged, { secret: SECRET })).toBeNull()
  })

  it('rejects malformed tokens and wrong prefix', async () => {
    expect(await verifyDelegatedToolToken('not-a-token', { secret: SECRET })).toBeNull()
    expect(await verifyDelegatedToolToken('dtt_only-one-segment', { secret: SECRET })).toBeNull()
    expect(await verifyDelegatedToolToken('dtt_.sig', { secret: SECRET })).toBeNull()
    expect(await verifyDelegatedToolToken('foo_abc.def', { secret: SECRET })).toBeNull()
  })
})

describe('issueDelegatedToolLease', () => {
  it('packages token + allow-list + expiry + callbackUrl', async () => {
    const t0 = 2_000_000_000_000
    const lease = await issueDelegatedToolLease({
      workspaceId: WORKSPACE,
      allowedTools: ['gcal__events.create'],
      ttlSeconds: 300,
      secret: SECRET,
      callbackUrl: 'https://app.example/api/delegated/mcp',
      now: t0,
    })
    expect(lease).not.toBeNull()
    expect(lease!.allowedTools).toEqual(['gcal__events.create'])
    expect(lease!.expiresAt).toBe(t0 + 300_000)
    expect(lease!.callbackUrl).toBe('https://app.example/api/delegated/mcp')
    const claims = await verifyDelegatedToolToken(lease!.token, { secret: SECRET, now: t0 })
    expect(claims!.workspaceId).toBe(WORKSPACE)
  })

  it('fail-closed: no secret ⇒ null lease', async () => {
    expect(
      await issueDelegatedToolLease({ workspaceId: WORKSPACE, allowedTools: ['x'], ttlSeconds: 60 }),
    ).toBeNull()
  })
})

function tool(name: string, invoke?: ResolvedDelegatedTool['invoke']): ResolvedDelegatedTool {
  return {
    name,
    description: `desc ${name}`,
    invoke: invoke ?? (async (args) => ({ ok: true, echo: args })),
  }
}

function seams(overrides: Partial<DelegatedToolCallSeams> = {}): DelegatedToolCallSeams {
  return {
    verifyToken: async (bearer) => verifyDelegatedToolToken(bearer, { secret: SECRET }),
    resolveTool: async (_ws, name) => (name === 'gcal__create' ? tool(name) : null),
    isIntegrationConnected: async () => true,
    ...overrides,
  }
}

async function bearer(allowedTools: string[]): Promise<string> {
  const token = await mintDelegatedToolToken({ workspaceId: WORKSPACE, allowedTools, ttlSeconds: 600, secret: SECRET })
  return `Bearer ${token}`
}

describe('handleDelegatedToolCall — JSON-RPC envelope', () => {
  it('initialize returns protocol + serverInfo', async () => {
    const res = await handleDelegatedToolCall(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      await bearer(['gcal__create']),
      seams({ serverInfo: { name: 'creative', version: '9' } }),
    )
    expect(res.id).toBe(1)
    expect((res.result as any).serverInfo).toEqual({ name: 'creative', version: '9' })
    expect((res.result as any).protocolVersion).toBeDefined()
  })

  it('tools/list returns allow-list ∩ resolvable ∩ connected', async () => {
    const res = await handleDelegatedToolCall(
      { id: 2, method: 'tools/list' },
      await bearer(['gcal__create', 'unknown__tool']),
      seams(),
    )
    const tools = (res.result as any).tools
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('gcal__create')
    expect(tools[0].inputSchema).toEqual({ type: 'object' })
  })

  it('tools/list omits disconnected tools', async () => {
    const res = await handleDelegatedToolCall(
      { id: 3, method: 'tools/list' },
      await bearer(['gcal__create']),
      seams({ isIntegrationConnected: async () => false }),
    )
    expect((res.result as any).tools).toHaveLength(0)
  })

  it('tools/call happy path invokes and returns result', async () => {
    const res = await handleDelegatedToolCall(
      { id: 4, method: 'tools/call', params: { name: 'gcal__create', arguments: { title: 'Sync' } } },
      await bearer(['gcal__create']),
      seams(),
    )
    expect(res.error).toBeUndefined()
    expect(res.result).toEqual({ ok: true, echo: { title: 'Sync' } })
  })

  it('unknown method ⇒ -32601', async () => {
    const res = await handleDelegatedToolCall(
      { id: 5, method: 'frobnicate' },
      await bearer(['gcal__create']),
      seams(),
    )
    expect(res.error?.code).toBe(-32601)
  })
})

describe('handleDelegatedToolCall — fail-closed gates', () => {
  it('gate 1: missing/invalid bearer ⇒ -32001', async () => {
    const res = await handleDelegatedToolCall({ id: 1, method: 'tools/list' }, undefined, seams())
    expect(res.error?.code).toBe(-32001)
    const res2 = await handleDelegatedToolCall({ id: 1, method: 'tools/list' }, 'Bearer dtt_bogus.sig', seams())
    expect(res2.error?.code).toBe(-32001)
  })

  it('gate 2: tool not in lease allow-list ⇒ -32602', async () => {
    const res = await handleDelegatedToolCall(
      { id: 2, method: 'tools/call', params: { name: 'gcal__create' } },
      await bearer(['slack__post']),
      seams(),
    )
    expect(res.error?.code).toBe(-32602)
    expect(res.error?.message).toContain('not delegated')
  })

  it('gate 3: tool does not resolve for workspace ⇒ -32602', async () => {
    const res = await handleDelegatedToolCall(
      { id: 3, method: 'tools/call', params: { name: 'ghost__tool' } },
      await bearer(['ghost__tool']),
      seams(),
    )
    expect(res.error?.code).toBe(-32602)
    expect(res.error?.message).toContain('not available')
  })

  it('gate 4: integration disconnected ⇒ -32602, invoke never runs', async () => {
    let invoked = false
    const res = await handleDelegatedToolCall(
      { id: 4, method: 'tools/call', params: { name: 'gcal__create' } },
      await bearer(['gcal__create']),
      seams({
        resolveTool: async (_ws, name) => tool(name, async () => { invoked = true; return {} }),
        isIntegrationConnected: async () => false,
      }),
    )
    expect(res.error?.code).toBe(-32602)
    expect(res.error?.message).toContain('not connected')
    expect(invoked).toBe(false)
  })

  it('expired bearer is rejected at the verify gate', async () => {
    const t0 = 1_000_000_000_000
    const token = await mintDelegatedToolToken({ workspaceId: WORKSPACE, allowedTools: ['gcal__create'], ttlSeconds: 60, secret: SECRET, now: t0 })
    const res = await handleDelegatedToolCall(
      { id: 5, method: 'tools/call', params: { name: 'gcal__create' } },
      `Bearer ${token}`,
      seams({ verifyToken: async (b) => verifyDelegatedToolToken(b, { secret: SECRET, now: t0 + 120_000 }) }),
    )
    expect(res.error?.code).toBe(-32001)
  })
})

describe('handleDelegatedToolCall — invocation errors', () => {
  it('DelegatedToolInvocationError surfaces its code + data', async () => {
    const res = await handleDelegatedToolCall(
      { id: 1, method: 'tools/call', params: { name: 'gcal__create' } },
      await bearer(['gcal__create']),
      seams({
        resolveTool: async (_ws, name) =>
          tool(name, async () => {
            throw new DelegatedToolInvocationError('hub 502', { code: -32050, data: { status: 502 } })
          }),
      }),
    )
    expect(res.error?.code).toBe(-32050)
    expect(res.error?.data).toEqual({ status: 502 })
  })

  it('arbitrary throw ⇒ -32000', async () => {
    const res = await handleDelegatedToolCall(
      { id: 2, method: 'tools/call', params: { name: 'gcal__create' } },
      await bearer(['gcal__create']),
      seams({ resolveTool: async (_ws, name) => tool(name, async () => { throw new Error('boom') }) }),
    )
    expect(res.error?.code).toBe(-32000)
    expect(res.error?.message).toBe('boom')
  })
})

describe('handleDelegatedToolRequest — HTTP transport', () => {
  function req(bodyObj: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
    return new Request('https://app.example/api/delegated/mcp', {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'POST' ? JSON.stringify(bodyObj) : undefined,
    })
  }

  it('non-POST ⇒ 405', async () => {
    const res = await handleDelegatedToolRequest(req({}, {}, 'GET'), seams())
    expect(res.status).toBe(405)
  })

  it('bad JSON ⇒ parse error -32700', async () => {
    const request = new Request('https://app.example/x', { method: 'POST', body: '{not json' })
    const res = await handleDelegatedToolRequest(request, seams())
    const json = (await res.json()) as any
    expect(json.error.code).toBe(-32700)
  })

  it('unauthorized ⇒ 401 status', async () => {
    const res = await handleDelegatedToolRequest(req({ id: 1, method: 'tools/list' }), seams())
    expect(res.status).toBe(401)
  })

  it('authorized call ⇒ 200 with result', async () => {
    const res = await handleDelegatedToolRequest(
      req(
        { id: 1, method: 'tools/call', params: { name: 'gcal__create', arguments: { a: 1 } } },
        { authorization: await bearer(['gcal__create']) },
      ),
      seams(),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.result).toEqual({ ok: true, echo: { a: 1 } })
  })

  it('authenticated JSON-RPC error rides a 200', async () => {
    const res = await handleDelegatedToolRequest(
      req({ id: 1, method: 'tools/call', params: { name: 'nope' } }, { authorization: await bearer(['gcal__create']) }),
      seams(),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.error.code).toBe(-32602)
  })
})
