import { afterEach, describe, expect, it, vi } from 'vitest'
import { ringcentralConnector } from '../ringcentral.js'
import { type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'ringcentral_at_test'

const source: ResolvedDataSource = {
  id: 'src_ringcentral',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'ringcentral',
  label: 'RingCentral',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: ACCESS_TOKEN },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ringcentral adapter', () => {
  it('routes extension.get against the ~ alias path under /restapi/v1.0 with bearer auth', async () => {
    const fetchMock = mockFetch({ id: '1' })
    await ringcentralConnector.executeRead!({ source, capabilityName: 'extension.get', args: {}, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://platform.ringcentral.com')
    expect(url.pathname).toBe('/restapi/v1.0/account/~/extension/~')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('sends an SMS via POST /account/~/extension/~/sms forwarding from/to/text', async () => {
    const fetchMock = mockFetch({ id: 'msg_1' })
    const result = await ringcentralConnector.executeMutation!({
      source,
      capabilityName: 'sms.send',
      args: { from: { phoneNumber: '+14155550100' }, to: [{ phoneNumber: '+14155550111' }], text: 'Hi' },
      idempotencyKey: 'op_1',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/restapi/v1.0/account/~/extension/~/sms')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({
      from: { phoneNumber: '+14155550100' },
      to: [{ phoneNumber: '+14155550111' }],
      text: 'Hi',
    })
  })
})
