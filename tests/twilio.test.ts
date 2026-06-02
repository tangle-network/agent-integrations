import { afterEach, describe, expect, it, vi } from 'vitest'
import { twilioConnector } from '../src/connectors/adapters/twilio.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_twilio_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'twilio',
    label: 'twilio test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { accountSid: 'AC123' },
    credentials: { kind: 'api-key', apiKey: 'twilio_secret' },
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

describe('twilio adapter manifest', () => {
  it('classifies itself as the comms category and exposes the twilio kind', () => {
    expect(twilioConnector.manifest.kind).toBe('twilio')
    expect(twilioConnector.manifest.category).toBe('comms')
    expect(twilioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = twilioConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full capability set (messages, calls, recordings, numbers)', () => {
    const names = twilioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'messages.send',
        'messages.get',
        'messages.list',
        'messages.delete',
        'calls.make',
        'calls.get',
        'calls.list',
        'calls.cancel',
        'calls.update',
        'recordings.get',
        'recordings.list',
        'numbers.list',
        'numbers.update',
      ].sort(),
    )
    const reads = twilioConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = twilioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'messages.get',
        'messages.list',
        'calls.get',
        'calls.list',
        'recordings.get',
        'recordings.list',
        'numbers.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['messages.send', 'messages.delete', 'calls.make', 'calls.cancel', 'calls.update', 'numbers.update'].sort(),
    )
  })

  it('marks every new mutation as native-idempotency + external effect', () => {
    const targets = ['messages.delete', 'calls.cancel', 'calls.update', 'numbers.update']
    for (const target of targets) {
      const cap = twilioConnector.manifest.capabilities.find((c) => c.name === target)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`expected mutation: ${target}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('twilio messages.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /Messages/{sid}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse(null, { status: 204 })
      }),
    )
    const result = await twilioConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.delete',
      args: { messageSid: 'SM_xyz' },
      idempotencyKey: 'del-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/Messages/SM_xyz.json')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      twilioConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.delete',
        args: { messageSid: 'SM_xyz' },
        idempotencyKey: 'del-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('twilio calls.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs Status=canceled to /Calls/{sid}.json', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = init?.body ? String(init.body) : undefined
        return jsonResponse({ sid: 'CA_1', status: 'canceled' })
      }),
    )
    const result = await twilioConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.cancel',
      args: { callSid: 'CA_1' },
      idempotencyKey: 'cancel-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/Calls/CA_1.json')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({ Status: 'canceled' })
  })
})

describe('twilio numbers.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /IncomingPhoneNumbers.json without supplying optional filters', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ incoming_phone_numbers: [] })
      }),
    )
    await twilioConnector.executeRead!({
      source: source(),
      capabilityName: 'numbers.list',
      args: { limit: 25 },
      idempotencyKey: 'num-1',
    })
    expect(String(requestUrl)).toContain('/IncomingPhoneNumbers.json')
    expect(String(requestUrl)).toContain('PageSize=25')
    expect(String(requestUrl)).not.toContain('PhoneNumber=')
  })
})
