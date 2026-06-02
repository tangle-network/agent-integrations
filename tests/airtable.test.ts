import { afterEach, describe, expect, it, vi } from 'vitest'
import { airtableConnector } from '../src/connectors/adapters/airtable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_airtable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'airtable',
    label: 'Airtable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'airtable_pat_test' },
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

describe('airtable adapter manifest', () => {
  it('exposes the airtable kind and spreadsheet category', () => {
    expect(airtableConnector.manifest.kind).toBe('airtable')
    expect(airtableConnector.manifest.category).toBe('spreadsheet')
  })

  it('covers the new write capability surface', () => {
    const names = airtableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.list',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
        'records.upsert',
        'records.batchCreate',
      ].sort(),
    )
  })

  it('marks records.delete / records.upsert / records.batchCreate as native-idempotency external effect', () => {
    const targets = ['records.delete', 'records.upsert', 'records.batchCreate']
    for (const name of targets) {
      const cap = airtableConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('airtable records.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /v0/{baseId}/{tableName}/{recordId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true, id: 'rec_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await airtableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.delete',
      args: { baseId: 'appXYZ', tableName: 'Contacts', recordId: 'rec_1' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.airtable.com/v0/appXYZ/Contacts/rec_1')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      airtableConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.delete',
        args: { baseId: 'appXYZ', tableName: 'Contacts', recordId: 'rec_1' },
        idempotencyKey: 'del-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('airtable records.batchCreate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v0/{baseId}/{tableName} with the records array', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ records: [{ id: 'rec_a' }, { id: 'rec_b' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await airtableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.batchCreate',
      args: {
        baseId: 'appXYZ',
        tableName: 'Contacts',
        records: [{ fields: { Name: 'A' } }, { fields: { Name: 'B' } }],
        typecast: true,
      },
      idempotencyKey: 'batch-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.airtable.com/v0/appXYZ/Contacts')
    expect(capturedBody).toEqual({
      records: [{ fields: { Name: 'A' } }, { fields: { Name: 'B' } }],
      typecast: true,
    })
    expect(result.status).toBe('committed')
  })
})

describe('airtable records.upsert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v0/{baseId}/{tableName} with performUpsert.fieldsToMergeOn', async () => {
    let capturedMethod = ''
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ records: [{ id: 'rec_a' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await airtableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.upsert',
      args: {
        baseId: 'appXYZ',
        tableName: 'Contacts',
        records: [{ fields: { Email: 'a@example.com', Name: 'A' } }],
        fieldsToMergeOn: ['Email'],
        typecast: false,
      },
      idempotencyKey: 'up-1',
    })

    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://api.airtable.com/v0/appXYZ/Contacts')
    expect(capturedBody).toMatchObject({
      records: [{ fields: { Email: 'a@example.com', Name: 'A' } }],
      performUpsert: { fieldsToMergeOn: ['Email'] },
      typecast: false,
    })
    expect(result.status).toBe('committed')
  })
})
