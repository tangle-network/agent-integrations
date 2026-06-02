import { afterEach, describe, expect, it, vi } from 'vitest'
import { telnyxConnector } from '../src/connectors/adapters/telnyx.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_telnyx_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'telnyx',
    label: 'telnyx test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'telnyx_secret' },
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

describe('telnyx adapter manifest', () => {
  it('classifies itself as the comms category and exposes the telnyx kind', () => {
    expect(telnyxConnector.manifest.kind).toBe('telnyx')
    expect(telnyxConnector.manifest.category).toBe('comms')
    expect(telnyxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Telnyx-specific hint', () => {
    const auth = telnyxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Telnyx/i)
  })

  it('covers messages, calls, and numbers capability surface', () => {
    const names = telnyxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('messages.send')
    expect(names).toContain('calls.create')
    expect(names).toContain('calls.list')
    expect(names).toContain('calls.get')
    expect(names).toContain('messages.list')
    expect(names).toContain('calls.hangup')
    expect(names).toContain('calls.transfer')
    expect(names).toContain('numbers.list')
    expect(names).toContain('numbers.update')
  })

  it('marks SMS, call initiation, hangup, transfer, and number update as mutations', () => {
    const mutations = telnyxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('messages.send')
    expect(mutations).toContain('calls.create')
    expect(mutations).toContain('calls.hangup')
    expect(mutations).toContain('calls.transfer')
    expect(mutations).toContain('numbers.update')
  })

  it('marks read-only operations as read', () => {
    const reads = telnyxConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('calls.list')
    expect(reads).toContain('calls.get')
    expect(reads).toContain('messages.list')
    expect(reads).toContain('numbers.list')
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['calls.hangup', 'calls.transfer', 'numbers.update']
    for (const name of expected) {
      const cap = telnyxConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('telnyx calls.hangup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/calls/{call_control_id}/actions/hangup', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ data: { result: 'ok' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await telnyxConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.hangup',
      args: { call_control_id: 'call_abc' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.telnyx.com/v2/calls/call_abc/actions/hangup')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      telnyxConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.hangup',
        args: { call_control_id: 'call_abc' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('telnyx calls.transfer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the destination to /v2/calls/{call_control_id}/actions/transfer', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { transferred: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await telnyxConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.transfer',
      args: { call_control_id: 'call_xyz', to: '+15551234567' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://api.telnyx.com/v2/calls/call_xyz/actions/transfer')
    expect(requestBody).toMatchObject({ to: '+15551234567' })
  })
})

describe('telnyx numbers.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v2/phone_numbers', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await telnyxConnector.executeRead!({
      source: source(),
      capabilityName: 'numbers.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('https://api.telnyx.com/v2/phone_numbers')
    expect(result.data).toEqual({ data: [] })
  })
})

describe('telnyx numbers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v2/phone_numbers/{phone_number_id} with the provided fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { id: 'num_1', customer_reference: 'cust_42' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await telnyxConnector.executeMutation!({
      source: source(),
      capabilityName: 'numbers.update',
      args: { phone_number_id: 'num_1', customer_reference: 'cust_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.telnyx.com/v2/phone_numbers/num_1')
    expect(requestBody).toMatchObject({ customer_reference: 'cust_42', phone_number_id: 'num_1' })
  })
})
