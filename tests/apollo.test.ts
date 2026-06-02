import { afterEach, describe, expect, it, vi } from 'vitest'
import { apolloConnector } from '../src/connectors/adapters/apollo.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_apollo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'apollo',
    label: 'Drew Apollo',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'apollo-test-key',
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('apollo adapter manifest', () => {
  it('classifies itself as the crm category and exposes the apollo kind', () => {
    expect(apolloConnector.manifest.kind).toBe('apollo')
    expect(apolloConnector.manifest.category).toBe('crm')
    expect(apolloConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = apolloConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the sequence enrollment write', () => {
    const names = apolloConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'match.person',
        'enrich.company',
        'news.articles.search',
        'organization.job.postings',
        'organization.search',
        'people.search',
        'sequences.add_contacts',
      ].sort(),
    )
    const reads = apolloConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = apolloConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'news.articles.search',
        'organization.job.postings',
        'organization.search',
        'people.search',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['enrich.company', 'match.person', 'sequences.add_contacts'].sort(),
    )
  })

  it('marks sequences.add_contacts as a side-effectful native-idempotent mutation', () => {
    const cap = apolloConnector.manifest.capabilities.find(
      (c) => c.name === 'sequences.add_contacts',
    )
    expect(cap).toBeDefined()
    if (!cap || cap.class !== 'mutation') throw new Error('sequences.add_contacts must be a mutation')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
    expect((cap.parameters as { required?: string[] }).required).toEqual([
      'campaign_id',
      'contact_ids',
    ])
  })
})

describe('apollo sequences.add_contacts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /v1/emailer_campaigns/{campaign_id}/add_contact_ids with the contact ids in the body and returns the upstream payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        contacts: [{ id: 'c_1' }, { id: 'c_2' }],
        emailer_campaign: { id: 'cmp_1' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apolloConnector.executeMutation!({
      source: source(),
      capabilityName: 'sequences.add_contacts',
      args: {
        campaign_id: 'cmp_1',
        contact_ids: ['c_1', 'c_2'],
        send_email_from_email_address: 'drew@example.com',
      },
      idempotencyKey: 'idemp-seq-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(
      'https://api.apollo.io/v1/emailer_campaigns/cmp_1/add_contact_ids',
    )
    expect(capturedHeaders['X-Api-Key']).toBe('apollo-test-key')
    expect(capturedBody).toEqual({
      contact_ids: ['c_1', 'c_2'],
      send_email_from_email_address: 'drew@example.com',
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({
      contacts: [{ id: 'c_1' }, { id: 'c_2' }],
      emailer_campaign: { id: 'cmp_1' },
    })
  })

  it('rejects when campaign_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      apolloConnector.executeMutation!({
        source: source(),
        capabilityName: 'sequences.add_contacts',
        args: { contact_ids: ['c_1'] },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/campaign_id/)
  })

  it('rejects when contact_ids is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      apolloConnector.executeMutation!({
        source: source(),
        capabilityName: 'sequences.add_contacts',
        args: { campaign_id: 'cmp_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/contact_ids/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      apolloConnector.executeMutation!({
        source: source(),
        capabilityName: 'sequences.add_contacts',
        args: {
          campaign_id: 'cmp_1',
          contact_ids: ['c_1'],
          send_email_from_email_address: 'drew@example.com',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      apolloConnector.executeMutation!({
        source: source(),
        capabilityName: 'sequences.add_contacts',
        args: {
          campaign_id: 'cmp_1',
          contact_ids: ['c_1'],
          send_email_from_email_address: 'drew@example.com',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
