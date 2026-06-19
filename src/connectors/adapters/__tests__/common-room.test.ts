import { afterEach, describe, expect, it, vi } from 'vitest'
import { commonRoomConnector } from '../common-room.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

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
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(commonRoomConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(commonRoomConnector.manifest.kind).toBe('common-room')
    expect(commonRoomConnector.manifest.displayName).toBe('Common Room')
    expect(commonRoomConnector.manifest.category).toBe('sales-intelligence')
    expect(commonRoomConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = commonRoomConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['activity_types.list', 'contact.get_by_email', 'contact.search', 'contact.upsert', 'segments.list'])
    const reads = commonRoomConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = commonRoomConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['activity_types.list', 'contact.get_by_email', 'contact.search', 'segments.list'])
    expect(mutations).toEqual(['contact.upsert'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof commonRoomConnector.executeRead).toBe('function')
    expect(typeof commonRoomConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of commonRoomConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes contact.get_by_email as GET /community/v1/user/jane%40example.com', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await commonRoomConnector.executeRead!({ source, capabilityName: 'contact.get_by_email', args: {"email":"jane@example.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/community/v1/user/jane%40example.com')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer common-room-key')
  })

  it('throws CredentialsExpired when Common Room rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      commonRoomConnector.executeRead!({ source, capabilityName: 'contact.get_by_email', args: {"email":"jane@example.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      commonRoomConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
