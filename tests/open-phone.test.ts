import { afterEach, describe, expect, it, vi } from 'vitest'
import { openPhoneConnector } from '../src/connectors/adapters/open-phone.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_open-phone_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'open-phone',
    label: 'open-phone test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'op_secret' },
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

describe('open-phone adapter manifest', () => {
  it('classifies itself as the other category and exposes the open-phone kind', () => {
    expect(openPhoneConnector.manifest.kind).toBe('open-phone')
    expect(openPhoneConnector.manifest.category).toBe('other')
    expect(openPhoneConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = openPhoneConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/OpenPhone/i)
  })

  it('covers the extended messages/contacts/calls capability surface', () => {
    const names = openPhoneConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'calls.create',
        'calls.summary',
        'calls.transfer',
        'contacts.create',
        'contacts.delete',
        'contacts.update',
        'messages.list',
        'messages.send',
      ].sort(),
    )
    const mutations = openPhoneConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'calls.create',
        'calls.transfer',
        'contacts.create',
        'contacts.delete',
        'contacts.update',
        'messages.send',
      ].sort(),
    )
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const required = new Set(['calls.create', 'contacts.delete', 'calls.transfer'])
    for (const cap of openPhoneConnector.manifest.capabilities) {
      if (!required.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('open-phone wire behavior', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('messages.list issues GET /messages with phoneNumberId in the query', async () => {
    let capturedUrl: string | undefined
    let capturedMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method
        return jsonResponse({ data: [{ id: 'msg_1' }] })
      }),
    )
    const result = await openPhoneConnector.executeRead!({
      source: source(),
      capabilityName: 'messages.list',
      args: { phoneNumberId: 'pn_123' },
      idempotencyKey: 'k',
    })
    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/v1/messages')
    expect(new URL(capturedUrl!).searchParams.get('phoneNumberId')).toBe('pn_123')
    expect((result.data as { data: unknown[] }).data).toHaveLength(1)
  })

  it('calls.create issues POST /calls with from/to in the body', async () => {
    let capturedUrl: string | undefined
    let capturedMethod: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ id: 'call_xyz' }, { status: 201 })
      }),
    )
    const result = await openPhoneConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.create',
      args: { from: '+15551234567', to: '+15557654321' },
      idempotencyKey: 'k-call',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/v1/calls')
    expect(capturedBody.from).toBe('+15551234567')
    expect(capturedBody.to).toBe('+15557654321')
    expect(result.status).toBe('committed')
  })

  it('contacts.delete issues DELETE /contacts/{contactId}', async () => {
    let capturedUrl: string | undefined
    let capturedMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )
    const result = await openPhoneConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: 'ct_42' },
      idempotencyKey: 'k-del',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/v1/contacts/ct_42')
    expect(result.status).toBe('committed')
  })

  it('calls.transfer POSTs /calls/{callId}/transfer', async () => {
    let capturedUrl: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ id: 'call_xyz', transferredTo: '+15550000000' })
      }),
    )
    const result = await openPhoneConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.transfer',
      args: { callId: 'call_xyz', to: '+15550000000' },
      idempotencyKey: 'k-xfer',
    })
    expect(capturedUrl).toContain('/v1/calls/call_xyz/transfer')
    expect(capturedBody.to).toBe('+15550000000')
    expect(result.status).toBe('committed')
  })

  it('calls.create surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      openPhoneConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.create',
        args: { from: '+1555', to: '+1666' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
