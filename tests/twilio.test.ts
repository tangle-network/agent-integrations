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
