import { afterEach, describe, expect, it, vi } from 'vitest'
import { mailchimpConnector } from '../mailchimp.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_mailchimp',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'mailchimp',
  label: 'mailchimp',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: { apiEndpoint: 'https://us20.api.mailchimp.com' },
  credentials: { kind: 'oauth2', accessToken: 'mc_token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mailchimp adapter', () => {
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(mailchimpConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares oauth2 against login.mailchimp.com with mailchimp-shaped env names', () => {
    const auth = mailchimpConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth.kind narrowing failed')
    expect(auth.authorizationUrl).toBe('https://login.mailchimp.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://login.mailchimp.com/oauth2/token')
    // Mailchimp OAuth2 grants are account-wide and the upstream ignores `scope` — keep it empty.
    expect(auth.scopes).toEqual([])
    expect(auth.clientIdEnv).toBe('MAILCHIMP_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MAILCHIMP_OAUTH_CLIENT_SECRET')
  })

  it('exposes the audience+member+campaign action surface and the right read/mutation split', () => {
    expect(mailchimpConnector.manifest.kind).toBe('mailchimp')
    expect(mailchimpConnector.manifest.displayName).toBe('Mailchimp')
    expect(mailchimpConnector.manifest.category).toBe('crm')
    const names = mailchimpConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'campaigns.list',
      'campaigns.send',
      'lists.get',
      'lists.list',
      'members.get',
      'members.search',
      'members.update-tags',
      'members.upsert',
    ])
    const readers = mailchimpConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = mailchimpConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual(['campaigns.list', 'lists.get', 'lists.list', 'members.get', 'members.search'])
    expect(mutators).toEqual(['campaigns.send', 'members.update-tags', 'members.upsert'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof mailchimpConnector.executeRead).toBe('function')
    expect(typeof mailchimpConnector.executeMutation).toBe('function')
  })

  it('routes reads against the per-tenant datacenter base URL with bearer auth', async () => {
    const fetchMock = mockFetch({ lists: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'lists.list',
      args: { count: 25 },
      idempotencyKey: 'lists_1',
    }

    await mailchimpConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://us20.api.mailchimp.com')
    expect(url.pathname).toBe('/3.0/lists')
    expect(url.searchParams.get('count')).toBe('25')
    // `offset` was not provided — declarative-REST must omit it, not send empty string.
    expect(url.searchParams.has('offset')).toBe(false)
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer mc_token_xyz' })
  })

  it('upserts an audience member with PUT against the subscriber-hash path and forwards the body verbatim', async () => {
    const fetchMock = mockFetch({ id: 'abcdef' })
    const memberBody = {
      email_address: 'ada@example.com',
      status_if_new: 'subscribed',
      merge_fields: { FNAME: 'Ada', LNAME: 'Lovelace' },
      tags: ['vip'],
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'members.upsert',
      args: { listId: 'list_42', subscriberHash: 'd41d8cd98f00b204e9800998ecf8427e', fields: memberBody },
      idempotencyKey: 'upsert_1',
    }

    const result = await mailchimpConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/3.0/lists/list_42/members/d41d8cd98f00b204e9800998ecf8427e')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer mc_token_xyz',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual(memberBody)
  })

  it('sends a campaign via POST against the actions/send endpoint with no body parameters required', async () => {
    const fetchMock = mockFetch({}, { status: 200 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'campaigns.send',
      args: { campaignId: 'camp_99' },
      idempotencyKey: 'send_1',
    }

    const result = await mailchimpConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/3.0/campaigns/camp_99/actions/send')
    expect(init.method).toBe('POST')
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
