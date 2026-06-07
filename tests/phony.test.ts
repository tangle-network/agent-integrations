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
    expect(names).toEqual(
      [
        'list_agents',
        'get_call',
        'list_calls',
        'start_outbound_call',
        'create_agent',
        'provision_agent',
        'kb_create_collection',
        'kb_ingest',
        'kb_search',
      ].sort(),
    )
  })

  it('classifies kb_search as a read and the agent/KB writes as mutations', () => {
    const byName = new Map(phonyConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('kb_search')?.class).toBe('read')
    for (const name of [
      'create_agent',
      'provision_agent',
      'kb_create_collection',
      'kb_ingest',
    ]) {
      const cap = byName.get(name)
      expect(cap?.class).toBe('mutation')
      if (cap?.class !== 'mutation') continue
      expect(cap.externalEffect).toBe(true)
      expect(cap.cas).toBe('none')
    }
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

  it('refuses missing consent before contacting ph0ny', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phonyConnector.executeMutation!({
        source: source(),
        capabilityName: 'start_outbound_call',
        args: {
          agentId: 'agent_1',
          toNumber: '+14155551234',
          fromNumber: '+14155550001',
          mission: { goal: 'Confirm the appointment time.' },
          userConsentRecorded: false,
        },
        idempotencyKey: 'start-no-consent',
      }),
    ).rejects.toThrow('requires userConsentRecorded=true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses malformed phone numbers before contacting ph0ny', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phonyConnector.executeMutation!({
        source: source(),
        capabilityName: 'start_outbound_call',
        args: {
          agentId: 'agent_1',
          toNumber: '555-1212',
          fromNumber: '+14155550001',
          mission: { goal: 'Confirm the appointment time.' },
          userConsentRecorded: true,
        },
        idempotencyKey: 'start-bad-phone',
      }),
    ).rejects.toThrow('toNumber must be E.164')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses too-short mission goals before contacting ph0ny', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phonyConnector.executeMutation!({
        source: source(),
        capabilityName: 'start_outbound_call',
        args: {
          agentId: 'agent_1',
          toNumber: '+14155551234',
          fromNumber: '+14155550001',
          mission: { goal: 'hi' },
          userConsentRecorded: true,
        },
        idempotencyKey: 'start-short-goal',
      }),
    ).rejects.toThrow('mission.goal must be at least 8 characters')
    expect(fetchMock).not.toHaveBeenCalled()
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

interface Captured {
  url?: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

function captureFetch(response: Response): Captured {
  const captured: Captured = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input)
      captured.method = init?.method
      captured.headers = init?.headers as Record<string, string>
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined
      return response
    }),
  )
  return captured
}

const BEARER = 'Bearer plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm'

describe('phony create_agent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/agents with a Bearer key and only the declared fields', async () => {
    const cap = captureFetch(jsonResponse({ id: 'agent_9', name: 'Booker', status: 'active' }, { status: 201 }))
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_agent',
      args: {
        name: 'Booker',
        systemPrompt: 'Book reservations politely.',
        llmProvider: 'openai',
        temperature: 0.4,
        contactCaptureFields: ['name', 'phone'],
        // Not in CreateAgentSchema — must be dropped.
        bogusField: 'nope',
      },
      idempotencyKey: 'create-1',
    })
    expect(cap.method).toBe('POST')
    expect(cap.url).toBe('https://api.ph0ny.com/v1/agents')
    expect(cap.headers?.authorization).toBe(BEARER)
    expect(cap.headers?.['content-type']).toBe('application/json')
    expect(cap.body).toEqual({
      name: 'Booker',
      systemPrompt: 'Book reservations politely.',
      llmProvider: 'openai',
      temperature: 0.4,
      contactCaptureFields: ['name', 'phone'],
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ agent: { id: 'agent_9', name: 'Booker' } })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      phonyConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_agent',
        args: { name: 'X' },
        idempotencyKey: 'create-401',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('phony provision_agent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/agents/provision with agent fields + collection + initialContent', async () => {
    const cap = captureFetch(
      jsonResponse(
        {
          agent: { id: 'agent_10', name: 'Concierge' },
          collection: { id: 'col_1', name: 'FAQ' },
          ingested: [{ documentId: 'doc_1', chunksCreated: 3, tokensUsed: 120 }],
        },
        { status: 201 },
      ),
    )
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'provision_agent',
      args: {
        name: 'Concierge',
        collection: { name: 'FAQ', description: 'House rules' },
        initialContent: [{ content: 'Check-in is 3pm.', contentType: 'text' }],
      },
      idempotencyKey: 'provision-1',
    })
    expect(cap.method).toBe('POST')
    expect(cap.url).toBe('https://api.ph0ny.com/v1/agents/provision')
    expect(cap.headers?.authorization).toBe(BEARER)
    expect(cap.body).toEqual({
      name: 'Concierge',
      collection: { name: 'FAQ', description: 'House rules' },
      initialContent: [{ content: 'Check-in is 3pm.', contentType: 'text' }],
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({
      agent: { id: 'agent_10' },
      collection: { id: 'col_1' },
      ingested: [{ documentId: 'doc_1' }],
    })
  })
})

describe('phony kb_create_collection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/collections with name + description', async () => {
    const cap = captureFetch(jsonResponse({ id: 'col_2', name: 'Pricing', documentCount: 0 }, { status: 201 }))
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'kb_create_collection',
      args: { name: 'Pricing', description: 'Plan tiers' },
      idempotencyKey: 'col-1',
    })
    expect(cap.method).toBe('POST')
    expect(cap.url).toBe('https://api.ph0ny.com/v1/collections')
    expect(cap.headers?.authorization).toBe(BEARER)
    expect(cap.body).toEqual({ name: 'Pricing', description: 'Plan tiers' })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ collection: { id: 'col_2', name: 'Pricing' } })
  })
})

describe('phony kb_ingest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/collections/:id/ingest with the collectionId routed in the path', async () => {
    const cap = captureFetch(jsonResponse({ documentId: 'doc_2', chunksCreated: 5, tokensUsed: 400 }, { status: 201 }))
    const result = await phonyConnector.executeMutation!({
      source: source(),
      capabilityName: 'kb_ingest',
      args: {
        collectionId: 'col_2',
        content: 'Our refund policy is 30 days.',
        contentType: 'text',
        chunkSize: 800,
      },
      idempotencyKey: 'ingest-1',
    })
    expect(cap.method).toBe('POST')
    expect(cap.url).toBe('https://api.ph0ny.com/v1/collections/col_2/ingest')
    expect(cap.headers?.authorization).toBe(BEARER)
    // collectionId is a path param — must NOT appear in the body.
    expect(cap.body).toEqual({
      content: 'Our refund policy is 30 days.',
      contentType: 'text',
      chunkSize: 800,
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ documentId: 'doc_2', chunksCreated: 5, tokensUsed: 400 })
  })
})

describe('phony kb_search', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/collections/:id/search as a read and returns ranked results', async () => {
    const cap = captureFetch(
      jsonResponse({
        results: [{ chunkId: 'c1', content: '30-day refunds.', score: 0.92 }],
        queryTokens: 4,
        graphContext: 'policy graph',
      }),
    )
    const result = await phonyConnector.executeRead!({
      source: source(),
      capabilityName: 'kb_search',
      args: { collectionId: 'col_2', query: 'refund window', limit: 3 },
      idempotencyKey: 'search-1',
    })
    expect(cap.method).toBe('POST')
    expect(cap.url).toBe('https://api.ph0ny.com/v1/collections/col_2/search')
    expect(cap.headers?.authorization).toBe(BEARER)
    expect(cap.headers?.['content-type']).toBe('application/json')
    // collectionId is a path param — body carries only the search args.
    expect(cap.body).toEqual({ query: 'refund window', limit: 3 })
    const data = result.data as { results: Array<{ score: number }>; queryTokens: number; graphContext: string }
    expect(data.results[0].score).toBe(0.92)
    expect(data.queryTokens).toBe(4)
    expect(data.graphContext).toBe('policy graph')
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      phonyConnector.executeRead!({
        source: source(),
        capabilityName: 'kb_search',
        args: { collectionId: 'col_2', query: 'x' },
        idempotencyKey: 'search-401',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
