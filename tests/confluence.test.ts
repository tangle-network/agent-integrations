import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confluenceConnector,
  validateConnectorManifest,
  type ConnectorInvocation,
  type ResolvedDataSource,
} from '../src/connectors/index'

const source: ResolvedDataSource = {
  id: 'src_confluence',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'confluence',
  label: 'Acme Confluence',
  consistencyModel: 'authoritative',
  scopes: [
    'read:confluence-content.all',
    'read:confluence-space.summary',
    'write:confluence-content',
    'search:confluence',
  ],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('confluence comments.create execution', () => {
  it('POSTs the comment envelope unchanged to /wiki/api/v2/footer-comments', async () => {
    const fetchMock = mockFetch({ id: 'cmt_1' })
    const comment = {
      pageId: 'page_42',
      body: { representation: 'storage', value: '<p>great work</p>' },
    }
    const result = await confluenceConnector.executeMutation!({
      source,
      capabilityName: 'comments.create',
      args: { cloudId: 'cloud_abc', comment },
      idempotencyKey: 'idem_cmt',
    })

    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/ex/confluence/cloud_abc/wiki/api/v2/footer-comments')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual(comment)
    expect(body.parentCommentId).toBeUndefined()
  })
})

describe('confluence adapter execution', () => {
  it('discovers the authorized Atlassian sites needed by cloudId-scoped actions', async () => {
    const resources = [
      {
        id: 'cloud_abc',
        url: 'https://acme.atlassian.net',
        name: 'Acme',
        scopes: ['read:confluence-content.all'],
      },
    ]
    const fetchMock = mockFetch(resources)
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'resources.list',
      args: {},
      idempotencyKey: 'idem_resources',
    }

    const result = await confluenceConnector.executeRead!(invocation)

    expect(result.data).toEqual(resources)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/oauth/token/accessible-resources')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token_xyz')
  })

  it('routes pages.get through the api.atlassian.com gateway with the cloudId in the path', async () => {
    const fetchMock = mockFetch({ id: 'page_1', title: 'Hello' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'pages.get',
      args: { cloudId: 'cloud_abc', pageId: 'page_1', bodyFormat: 'storage' },
      idempotencyKey: 'idem_1',
    }
    const result = await confluenceConnector.executeRead!(invocation)

    expect(result.data).toEqual({ id: 'page_1', title: 'Hello' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://api.atlassian.com/ex/confluence/cloud_abc/wiki/api/v2/pages/page_1')
    expect(String(url)).toContain('body-format=storage')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_xyz')
    expect(init.method).toBe('GET')
  })

  it('forwards the v2 page envelope unchanged so optional fields like parentId can be omitted', async () => {
    const fetchMock = mockFetch({ id: 'page_new', title: 'Created' }, { status: 200 })
    const page = {
      spaceId: 'space_1',
      title: 'New Page',
      status: 'current',
      body: { representation: 'storage', value: '<p>hello</p>' },
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'pages.create',
      args: { cloudId: 'cloud_abc', page },
      idempotencyKey: 'idem_2',
    }

    const result = await confluenceConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/ex/confluence/cloud_abc/wiki/api/v2/pages')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual(page)
    expect(body.parentId).toBeUndefined()
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
