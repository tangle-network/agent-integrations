import { afterEach, describe, expect, it, vi } from 'vitest'
import { aircallConnector } from '../src/connectors/adapters/aircall.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_aircall_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'aircall',
    label: 'aircall test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'aircall_secret' },
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

describe('aircall adapter manifest', () => {
  it('classifies itself as the comms category and exposes the aircall kind', () => {
    expect(aircallConnector.manifest.kind).toBe('aircall')
    expect(aircallConnector.manifest.category).toBe('comms')
    expect(aircallConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = aircallConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the new write-side mutations', () => {
    const names = aircallConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.find',
        'calls.get',
        'calls.comment',
        'calls.tag',
        'calls.transfer',
        'calls.archive',
        'contacts.find',
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'numbers.assign',
      ].sort(),
    )
    const reads = aircallConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = aircallConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['calls.find', 'calls.get', 'contacts.find'])
    expect(mutations).toEqual(
      [
        'calls.comment',
        'calls.tag',
        'calls.transfer',
        'calls.archive',
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'numbers.assign',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['contacts.delete', 'calls.transfer', 'calls.archive', 'numbers.assign']
    for (const name of expected) {
      const cap = aircallConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('aircall contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/contacts/{contactId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await aircallConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: 'contact_42' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.aircall.io/v1/contacts/contact_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      aircallConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { contactId: 'c_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('aircall calls.transfer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/calls/{callId}/transfers with the destination', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ transferred: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await aircallConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.transfer',
      args: { callId: 'call_1', to: '+15551234567' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.aircall.io/v1/calls/call_1/transfers')
    expect(requestBody).toMatchObject({ to: '+15551234567' })
  })
})

describe('aircall calls.archive', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/calls/{callId}/archive', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ archived: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await aircallConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.archive',
      args: { callId: 'call_99' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.aircall.io/v1/calls/call_99/archive')
  })
})

describe('aircall numbers.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/numbers/{numberId}/users with the assignment body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ assigned: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await aircallConnector.executeMutation!({
      source: source(),
      capabilityName: 'numbers.assign',
      args: { numberId: 'num_7', user_id: 'usr_1', team_id: '' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.aircall.io/v1/numbers/num_7/users')
    expect(requestBody).toMatchObject({ user_id: 'usr_1' })
  })
})
