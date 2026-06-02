import { afterEach, describe, expect, it, vi } from 'vitest'
import { salesforceConnector } from '../src/connectors/adapters/salesforce.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_salesforce_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'salesforce',
    label: 'salesforce test',
    consistencyModel: 'authoritative',
    scopes: ['api', 'refresh_token'],
    metadata: { instanceUrl: 'https://example.my.salesforce.com' },
    credentials: { kind: 'oauth2', accessToken: 'sf_access_token' },
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

describe('salesforce adapter manifest', () => {
  it('classifies itself as crm with oauth2 auth', () => {
    expect(salesforceConnector.manifest.kind).toBe('salesforce')
    expect(salesforceConnector.manifest.category).toBe('crm')
    expect(salesforceConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('covers the read + mutation capability surface', () => {
    const names = salesforceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.upload',
        'records.composite',
        'records.create',
        'records.delete',
        'records.get',
        'records.query',
        'records.update',
        'records.upsert',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency external effect', () => {
    const newOnes = new Set(['records.delete', 'records.upsert', 'records.composite', 'files.upload'])
    const caps = salesforceConnector.manifest.capabilities.filter((c) => newOnes.has(c.name))
    expect(caps.length).toBe(4)
    for (const cap of caps) {
      if (cap.class !== 'mutation') throw new Error(`${cap.name} should be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('salesforce records.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /sobjects/{objectName}/{recordId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await salesforceConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.delete',
      args: { objectName: 'Account', recordId: '001xx000003DGZQ' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe(
      'https://example.my.salesforce.com/services/data/v61.0/sobjects/Account/001xx000003DGZQ',
    )
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      salesforceConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.delete',
        args: { objectName: 'Account', recordId: '001xx' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('salesforce records.upsert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /sobjects/{objectName}/{externalIdField}/{externalId} with fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: '001xx', created: true, success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await salesforceConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.upsert',
      args: {
        objectName: 'Account',
        externalIdField: 'ExternalId__c',
        externalId: 'EXT-123',
        fields: { Name: 'Acme', Industry: 'Tech' },
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe(
      'https://example.my.salesforce.com/services/data/v61.0/sobjects/Account/ExternalId__c/EXT-123',
    )
    expect(requestBody).toMatchObject({ Name: 'Acme', Industry: 'Tech' })
  })
})

describe('salesforce records.composite', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the entire envelope to /services/data/v61.0/composite', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ compositeResponse: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const envelope = {
      allOrNone: true,
      compositeRequest: [
        { method: 'POST', url: '/services/data/v61.0/sobjects/Account', referenceId: 'a', body: { Name: 'Acme' } },
      ],
    }

    await salesforceConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.composite',
      args: envelope,
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://example.my.salesforce.com/services/data/v61.0/composite')
    expect(requestBody).toEqual(envelope)
  })
})

describe('salesforce files.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a ContentVersion record with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: '068xx', success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await salesforceConnector.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: {
        fields: {
          Title: 'invoice',
          PathOnClient: 'invoice.pdf',
          VersionData: 'aGVsbG8=',
          FirstPublishLocationId: '001xx000003DGZQ',
        },
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(
      'https://example.my.salesforce.com/services/data/v61.0/sobjects/ContentVersion',
    )
    expect(requestBody).toMatchObject({
      Title: 'invoice',
      PathOnClient: 'invoice.pdf',
      VersionData: 'aGVsbG8=',
      FirstPublishLocationId: '001xx000003DGZQ',
    })
  })
})
