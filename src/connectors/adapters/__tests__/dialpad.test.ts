import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialpadConnector } from '../dialpad.js'
import { type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'dialpad_at_test'

const source: ResolvedDataSource = {
  id: 'src_dialpad',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'dialpad',
  label: 'Dialpad',
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

describe('dialpad adapter', () => {
  it('routes calls.list as GET /api/v2/call (singular) with bearer auth', async () => {
    const fetchMock = mockFetch({ items: [] })
    await dialpadConnector.executeRead!({ source, capabilityName: 'calls.list', args: { started_after: 1700000000000 }, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://dialpad.com')
    expect(url.pathname).toBe('/api/v2/call')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(url.searchParams.get('started_after')).toBe('1700000000000')
  })

  it('routes calls.get to /api/v2/call/{id}', async () => {
    const fetchMock = mockFetch({ id: '5' })
    await dialpadConnector.executeRead!({ source, capabilityName: 'calls.get', args: { id: 5 }, idempotencyKey: 'op_1' })
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/call/5')
  })

  it('sends an SMS via POST /api/v2/sms forwarding the args body', async () => {
    const fetchMock = mockFetch({ id: 'sms_1' })
    const result = await dialpadConnector.executeMutation!({
      source,
      capabilityName: 'sms.send',
      args: { to_numbers: ['+14155550111'], text: 'Hello', user_id: 99 },
      idempotencyKey: 'op_2',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/sms')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({ to_numbers: ['+14155550111'], text: 'Hello', user_id: 99 })
  })
})
