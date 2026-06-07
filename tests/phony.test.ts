import { afterEach, describe, expect, it, vi } from 'vitest'
import { phonyConnector } from '../src/connectors/adapters/phony.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_phony_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'phony',
    label: 'phony test',
    consistencyModel: 'cache',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('phony adapter manifest', () => {
  it('marks every mutation as external effect with a declared CAS', () => {
    const mutations = phonyConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const c of mutations) {
      if (c.class !== 'mutation') continue
      expect(c.externalEffect).toBe(true)
      expect(c.cas).toBeTruthy()
    }
  })

  it('exposes the read + write capabilities', () => {
    const names = phonyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['list_agents', 'get_call', 'list_calls', 'start_outbound_call'].sort())
  })

  it('requires the consent gate on start_outbound_call', () => {
    const start = phonyConnector.manifest.capabilities.find((c) => c.name === 'start_outbound_call')
    const required = (start?.parameters.required ?? []) as string[]
    expect(required).toContain('userConsentRecorded')
  })
})

describe('phony list_agents', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/agents with a Bearer key and limit', async () => {
    let requestUrl: string | undefined
    let requestHeaders: Record<string, string> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestHeaders = init?.headers as Record<string, string>
        return jsonResponse({ data: [{ id: 'agent_1', name: 'PA' }], nextCursor: 'agent_1', hasMore: true })
      }),
    )
    const result = await phonyConnector.executeRead!({
      source: source(),
      capabilityName: 'list_agents',
      args: { limit: 5 },
      idempotencyKey: 'agents-1',
    })
    expect(String(requestUrl)).toContain('https://api.ph0ny.com/v1/agents')
    expect(String(requestUrl)).toContain('limit=5')
    expect(requestHeaders?.authorization).toBe('Bearer plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm')
    const data = result.data as { agents: Array<{ id: string }>; nextCursor: string; hasMore: boolean }
    expect(data.agents[0].id).toBe('agent_1')
    expect(data.nextCursor).toBe('agent_1')
    expect(data.hasMore).toBe(true)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      phonyConnector.executeRead!({
        source: source(),
        capabilityName: 'list_agents',
        args: {},
        idempotencyKey: 'agents-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('phony get_call + list_calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/outbound/:id', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ call: { id: 'oc_1', status: 'completed' } })
      }),
    )
    const result = await phonyConnector.executeRead!({
      source: source(),
      capabilityName: 'get_call',
      args: { id: 'oc_1' },
      idempotencyKey: 'call-1',
    })
    expect(String(requestUrl)).toBe('https://api.ph0ny.com/v1/outbound/oc_1')
    const data = result.data as { call: { id: string } }
    expect(data.call.id).toBe('oc_1')
  })

  it('GETs /v1/outbound with agentId + limit filters', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ calls: [{ id: 'oc_1' }, { id: 'oc_2' }] })
      }),
    )
    const result = await phonyConnector.executeRead!({
      source: source(),
      capabilityName: 'list_calls',
      args: { agentId: 'agent_1', limit: 10 },
      idempotencyKey: 'calls-1',
    })
    expect(String(requestUrl)).toContain('https://api.ph0ny.com/v1/outbound?')
    expect(String(requestUrl)).toContain('agentId=agent_1')
    expect(String(requestUrl)).toContain('limit=10')
    const data = result.data as { calls: unknown[] }
    expect(data.calls).toHaveLength(2)
  })
})

describe('phony start_outbound_call', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/outbound/start with the consent gate and mission', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestHeaders = init?.headers as Record<string, string>
        requestBody = JSON.parse(String(init?.body))
        return jsonResponse({ callSid: 'CA_1', callId: 'oc_1', status: 'initiated' }, { status: 201 })
      }),
    )
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'start_outbound_call',
      args: {
        agentId: 'agent_1',
        toNumber: '+14155551234',
        fromNumber: '+14155550001',
        mission: { goal: 'Book a table for two at 7pm.' },
        userConsentRecorded: true,
      },
      idempotencyKey: 'start-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.ph0ny.com/v1/outbound/start')
    expect(requestHeaders?.authorization).toBe('Bearer plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm')
    expect(requestHeaders?.['content-type']).toBe('application/json')
    expect(requestBody).toMatchObject({
      agentId: 'agent_1',
      toNumber: '+14155551234',
      fromNumber: '+14155550001',
      mission: { goal: 'Book a table for two at 7pm.' },
      userConsentRecorded: true,
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ callId: 'oc_1', callSid: 'CA_1', callStatus: 'initiated', dryRun: false })
  })

  it('passes dryRun through and returns the dryRunReport', async () => {
    let requestBody: { dryRun?: boolean } | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body))
        return jsonResponse({
          dryRun: true,
          callSid: null,
          callId: null,
          status: 'dry_run',
          dryRunReport: { verdict: 'would_call' },
        })
      }),
    )
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'start_outbound_call',
      args: {
        agentId: 'agent_1',
        toNumber: '+14155551234',
        fromNumber: '+14155550001',
        mission: { goal: 'Confirm the appointment time.' },
        userConsentRecorded: true,
        dryRun: true,
      },
      idempotencyKey: 'start-dry-1',
    })
    expect(requestBody?.dryRun).toBe(true)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ dryRun: true, callId: null, dryRunReport: { verdict: 'would_call' } })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      phonyConnector.executeMutation!({
        source: source(),
        capabilityName: 'start_outbound_call',
        args: {
          agentId: 'agent_1',
          toNumber: '+14155551234',
          fromNumber: '+14155550001',
          mission: { goal: 'Reschedule the delivery.' },
          userConsentRecorded: true,
        },
        idempotencyKey: 'start-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('phony test()', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses GET /v1/outbound?limit=1 as the cheapest authed probe', async () => {
    let requestUrl: string | undefined
    let requestHeaders: Record<string, string> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestHeaders = init?.headers as Record<string, string>
        return jsonResponse({ calls: [] })
      }),
    )
    const result = await phonyConnector.test(source())
    expect(result).toEqual({ ok: true })
    expect(String(requestUrl)).toBe('https://api.ph0ny.com/v1/outbound?limit=1')
    expect(requestHeaders?.authorization).toBe('Bearer plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm')
  })

  it('reports a reconnect-required reason on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const result = await phonyConnector.test(source())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('401')
  })
})
