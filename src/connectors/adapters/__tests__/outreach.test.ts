import { afterEach, describe, expect, it, vi } from 'vitest'
import { outreachConnector } from '../outreach.js'
import { type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'outreach_at_test'

const source: ResolvedDataSource = {
  id: 'src_outreach',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'outreach',
  label: 'Outreach',
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

describe('outreach adapter', () => {
  it('routes prospects.list as GET /api/v2/prospects with the email filter and bearer auth', async () => {
    const fetchMock = mockFetch({ data: [] })
    await outreachConnector.executeRead!({ source, capabilityName: 'prospects.list', args: { email: 'ada@example.com' }, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.outreach.io')
    expect(url.pathname).toBe('/api/v2/prospects')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(url.searchParams.get('filter[emails][email]')).toBe('ada@example.com')
    // Unprovided params must be omitted, not sent empty.
    expect(url.searchParams.has('page[after]')).toBe(false)
  })

  it('wraps prospects.create in the JSON:API envelope, drops absent relationships, and pins the vnd.api+json media type', async () => {
    const fetchMock = mockFetch({ data: { id: '99', type: 'prospect' } })
    const attributes = { firstName: 'Ada', lastName: 'Lovelace', emails: [{ email: 'ada@example.com', emailType: 'work' }] }
    const result = await outreachConnector.executeMutation!({ source, capabilityName: 'prospects.create', args: { attributes }, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/prospects')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/vnd.api+json')
    expect(JSON.parse(String(init.body))).toEqual({ data: { type: 'prospect', attributes } })
  })

  it('enrolls a prospect into a sequence with a fully-specified JSON:API relationships envelope', async () => {
    const fetchMock = mockFetch({ data: { id: '5', type: 'sequenceState' } })
    await outreachConnector.executeMutation!({ source, capabilityName: 'sequenceStates.create', args: { prospectId: 123, sequenceId: 456 }, idempotencyKey: 'op_2' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/sequenceStates')
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: 'sequenceState',
        relationships: {
          prospect: { data: { type: 'prospect', id: 123 } },
          sequence: { data: { type: 'sequence', id: 456 } },
        },
      },
    })
  })
})
