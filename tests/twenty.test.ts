import { afterEach, describe, expect, it, vi } from 'vitest'
import { twentyConnector } from '../src/connectors/adapters/twenty.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_twenty_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'twenty',
    label: 'twenty test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://api.twenty.example/v1' },
    credentials: { kind: 'api-key', apiKey: 'twenty_secret' },
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

describe('twenty adapter manifest', () => {
  it('classifies itself as the crm category and exposes the twenty kind', () => {
    expect(twentyConnector.manifest.kind).toBe('twenty')
    expect(twentyConnector.manifest.category).toBe('crm')
    expect(twentyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = twentyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers contacts, companies, opportunities, and notes capabilities', () => {
    const names = twentyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.create')
    expect(names).toContain('contacts.find')
    expect(names).toContain('contacts.update')
    expect(names).toContain('contacts.delete')
    expect(names).toContain('companies.create')
    expect(names).toContain('companies.find')
    expect(names).toContain('companies.update')
    expect(names).toContain('companies.delete')
    expect(names).toContain('opportunities.create')
    expect(names).toContain('opportunities.update')
    expect(names).toContain('opportunities.delete')
    expect(names).toContain('notes.create')
  })

  it('marks new write-side capabilities as native-idempotency external-effect', () => {
    for (const name of [
      'contacts.delete',
      'companies.delete',
      'opportunities.update',
      'opportunities.delete',
      'notes.create',
    ]) {
      const cap = twentyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('twenty contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a deletePerson GraphQL mutation to /graphql', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { deletePerson: { id: 'person_xyz' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { personId: 'person_xyz' },
      idempotencyKey: 'k-cd',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/graphql')
    expect(requestBody).toContain('deletePerson')
    expect(requestBody).toContain('person_xyz')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      twentyConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { personId: 'person_xyz' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('twenty companies.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a deleteCompany GraphQL mutation', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { deleteCompany: { id: 'company_abc' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'companies.delete',
      args: { companyId: 'company_abc' },
      idempotencyKey: 'k-cod',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/graphql')
    expect(requestBody).toContain('deleteCompany')
    expect(requestBody).toContain('company_abc')
  })
})

describe('twenty opportunities.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs an updateOpportunity GraphQL mutation', async () => {
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { updateOpportunity: { id: 'opp_1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'opportunities.update',
      args: {
        opportunityId: 'opp_1',
        name: 'Renamed Deal',
        amount: 12345,
        currency: 'USD',
        stage: 'PROPOSAL',
        closeDate: '2026-07-01',
      },
      idempotencyKey: 'k-ou',
    })

    expect(result.status).toBe('committed')
    expect(requestBody).toContain('updateOpportunity')
    expect(requestBody).toContain('opp_1')
    expect(requestBody).toContain('Renamed Deal')
  })
})

describe('twenty opportunities.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a deleteOpportunity GraphQL mutation', async () => {
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { deleteOpportunity: { id: 'opp_1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'opportunities.delete',
      args: { opportunityId: 'opp_1' },
      idempotencyKey: 'k-od',
    })

    expect(result.status).toBe('committed')
    expect(requestBody).toContain('deleteOpportunity')
    expect(requestBody).toContain('opp_1')
  })
})

describe('twenty notes.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a createNote GraphQL mutation with all required fields', async () => {
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ data: { createNote: { id: 'note_1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twentyConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.create',
      args: {
        title: 'Call summary',
        body: 'They want a follow-up next week.',
        targetType: 'person',
        targetId: 'person_xyz',
      },
      idempotencyKey: 'k-nc',
    })

    expect(result.status).toBe('committed')
    expect(requestBody).toContain('createNote')
    expect(requestBody).toContain('Call summary')
    expect(requestBody).toContain('person_xyz')
  })
})
