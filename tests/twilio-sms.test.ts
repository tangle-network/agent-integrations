import { afterEach, describe, expect, it, vi } from 'vitest'
import { twilioSmsConnector } from '../src/connectors/adapters/twilio-sms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_twilio_sms_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'twilio-sms',
    label: 'twilio-sms test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { fromNumber: '+14155550001' },
    credentials: { kind: 'api-key', apiKey: 'AC123456789abcdef:auth_secret' },
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

describe('twilio-sms adapter manifest', () => {
  it('marks every mutation as native-idempotency + external effect', () => {
    const caps = twilioSmsConnector.manifest.capabilities
    const mutations = caps.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const c of mutations) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })

  it('exposes the new write + read capabilities', () => {
    const names = twilioSmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'send_sms',
        'send_mms',
        'send_whatsapp',
        'redact_message',
        'lookup_number',
        'find_recent_messages',
        'list_numbers',
      ].sort(),
    )
  })
})

describe('twilio-sms send_mms', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts MediaUrl entries and includes the idempotency-key header', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    let requestHeaders: Record<string, string> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ sid: 'SM_mms', status: 'queued', to: '+14155551234', from: '+14155550001' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twilioSmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'send_mms',
      args: {
        to: '+14155551234',
        mediaUrl: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
        body: 'pic',
      },
      idempotencyKey: 'mms-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/Accounts/AC123456789abcdef/Messages.json')
    expect(requestHeaders?.['idempotency-key']).toBe('mms-1')
    expect(requestBody).toContain('MediaUrl=https%3A%2F%2Fcdn.example.com%2Fa.jpg')
    expect(requestBody).toContain('MediaUrl=https%3A%2F%2Fcdn.example.com%2Fb.jpg')
    expect(requestBody).toContain('Body=pic')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      twilioSmsConnector.executeMutation!({
        source: source(),
        capabilityName: 'send_mms',
        args: { to: '+14155551234', mediaUrl: 'https://cdn.example.com/a.jpg' },
        idempotencyKey: 'mms-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('twilio-sms send_whatsapp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prepends whatsapp: prefix to To/From', async () => {
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body)
        return jsonResponse({ sid: 'SM_wa', status: 'queued', to: 'whatsapp:+14155551234', from: 'whatsapp:+14155550001' })
      }),
    )
    const result = await twilioSmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'send_whatsapp',
      args: { to: '+14155551234', body: 'hi' },
      idempotencyKey: 'wa-1',
    })
    expect(result.status).toBe('committed')
    expect(requestBody).toContain('To=whatsapp%3A%2B14155551234')
    expect(requestBody).toContain('From=whatsapp%3A%2B14155550001')
    expect(requestBody).toContain('Body=hi')
  })
})

describe('twilio-sms redact_message', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /Messages/{sid}.json with Body=""', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body)
        return jsonResponse({ sid: 'SM_redacted', status: 'delivered', body: '' })
      }),
    )
    const result = await twilioSmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'redact_message',
      args: { messageSid: 'SM_redacted' },
      idempotencyKey: 'redact-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/Messages/SM_redacted.json')
    expect(requestBody).toBe('Body=')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      twilioSmsConnector.executeMutation!({
        source: source(),
        capabilityName: 'redact_message',
        args: { messageSid: 'SM_redacted' },
        idempotencyKey: 'redact-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('twilio-sms list_numbers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs IncomingPhoneNumbers.json with PageSize', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({
          incoming_phone_numbers: [{ sid: 'PN_1', phone_number: '+14155550001', friendly_name: 'main' }],
        })
      }),
    )
    const result = await twilioSmsConnector.executeRead!({
      source: source(),
      capabilityName: 'list_numbers',
      args: { limit: 25 },
      idempotencyKey: 'list-1',
    })
    expect(String(requestUrl)).toContain('/Accounts/AC123456789abcdef/IncomingPhoneNumbers.json')
    expect(String(requestUrl)).toContain('PageSize=25')
    const data = result.data as { numbers: Array<{ sid: string }> }
    expect(data.numbers).toHaveLength(1)
    expect(data.numbers[0].sid).toBe('PN_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      twilioSmsConnector.executeRead!({
        source: source(),
        capabilityName: 'list_numbers',
        args: {},
        idempotencyKey: 'list-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
