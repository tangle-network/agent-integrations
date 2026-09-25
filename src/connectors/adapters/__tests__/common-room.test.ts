import { afterEach, describe, expect, it, vi } from 'vitest'
import { commonRoomConnector } from '../common-room.js'
import { type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_common_room',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'common-room',
  label: 'Common Room',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'common-room-key' },
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

describe('common-room adapter', () => {
  it('routes contact.get_by_email as GET /community/v1/user/jane%40example.com', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await commonRoomConnector.executeRead!({ source, capabilityName: 'contact.get_by_email', args: {"email":"jane@example.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/community/v1/user/jane%40example.com')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer common-room-key')
  })
})
