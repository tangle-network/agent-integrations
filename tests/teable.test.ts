import { afterEach, describe, expect, it, vi } from 'vitest'
import { teableConnector } from '../src/connectors/adapters/teable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_teable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'teable',
    label: 'teable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'teable_access',
      refreshToken: 'teable_refresh',
      expiresAt: Date.now() + 3_600_000,
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface CapturedRequest {
  url: URL
  method: string
  headers: Headers
  body: unknown
}

function captureFetch(responseBody: unknown, status = 200): () => CapturedRequest {
  let captured: CapturedRequest | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = typeof init?.body === 'string' ? init.body : undefined
      captured = {
        url: new URL(String(input)),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: rawBody ? JSON.parse(rawBody) : undefined,
      }
      return jsonResponse(responseBody, status)
    }),
  )
  return () => {
    if (!captured) throw new Error('expected fetch to be called')
    return captured
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('teable adapter manifest', () => {
  it('uses Teable Cloud OAuth endpoints, PKCE, and capability-aligned scopes', () => {
    expect(teableConnector.manifest).toMatchObject({
      kind: 'teable',
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
    })

    const auth = teableConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected Teable OAuth')
    expect(auth.authorizationUrl).toBe('https://app.teable.ai/api/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://app.teable.ai/api/oauth/access_token')
    expect(auth.pkce).toBe('supported')
    expect(auth.scopes).toEqual([
      'base|read',
      'table|read',
      'table|create',
      'field|create',
      'view|create',
      'record|read',
      'record|create',
      'record|update',
    ])
  })

  it('exposes only operations supported by the declarative runtime', () => {
    const capabilities = Object.fromEntries(
      teableConnector.manifest.capabilities.map((capability) => [capability.name, capability]),
    )
    expect(Object.keys(capabilities).sort()).toEqual(
      [
        'fields.create',
        'records.create',
        'records.find',
        'records.get',
        'records.update',
        'tables.create',
        'tables.list',
        'views.create',
      ].sort(),
    )
    expect(capabilities['records.create']?.requiredScopes).toEqual(['record|create'])
    expect(capabilities['records.find']?.requiredScopes).toEqual(['record|read'])
    expect(capabilities['records.get']?.requiredScopes).toEqual(['record|read'])
    expect(capabilities['records.update']?.requiredScopes).toEqual(['record|update'])
    expect(capabilities['tables.list']?.requiredScopes).toEqual(['table|read'])
    expect(capabilities['tables.create']?.requiredScopes).toEqual(['table|create'])
    expect(capabilities['fields.create']?.requiredScopes).toEqual(['field|create'])
    expect(capabilities['views.create']?.requiredScopes).toEqual(['view|create'])
    expect(capabilities['records.delete']).toBeUndefined()
    expect(capabilities['attachments.upload']).toBeUndefined()
  })
})

describe('teable connection test', () => {
  it('checks the authenticated user through the /api route', async () => {
    const request = captureFetch({ id: 'usr_1', name: 'Ada' })

    await expect(teableConnector.test(source())).resolves.toEqual({ ok: true })

    expect(request()).toMatchObject({ method: 'GET' })
    expect(request().url.href).toBe('https://app.teable.ai/api/auth/user/me')
    expect(request().headers.get('authorization')).toBe('Bearer teable_access')
  })
})

describe('teable records.create', () => {
  it('wraps one record in Teable\'s records array', async () => {
    const request = captureFetch({ records: [{ id: 'rec_1', fields: { Name: 'Ada' } }] }, 201)

    const result = await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.create',
      args: {
        tableId: 'tbl_1',
        fields: { Name: 'Ada' },
        fieldKeyType: 'name',
        typecast: true,
      },
      idempotencyKey: 'k-record-create',
    })

    expect(result.status).toBe('committed')
    expect(request().method).toBe('POST')
    expect(request().url.href).toBe('https://app.teable.ai/api/table/tbl_1/record')
    expect(request().headers.get('authorization')).toBe('Bearer teable_access')
    expect(request().body).toEqual({
      records: [{ fields: { Name: 'Ada' } }],
      fieldKeyType: 'name',
      typecast: true,
    })
  })
})

describe('teable records.find', () => {
  it('uses Teable take/skip pagination on the singular record route', async () => {
    const request = captureFetch({ records: [{ id: 'rec_1' }] })
    const filter = JSON.stringify({ conjunction: 'and', filterSet: [] })

    const result = await teableConnector.executeRead!({
      source: source(),
      capabilityName: 'records.find',
      args: {
        tableId: 'tbl_1',
        filter,
        take: 25,
        skip: 50,
        viewId: 'viw_1',
        fieldKeyType: 'id',
        cellFormat: 'text',
      },
      idempotencyKey: 'k-record-find',
    })

    expect(result.data).toEqual({ records: [{ id: 'rec_1' }] })
    expect(request().method).toBe('GET')
    expect(request().url.pathname).toBe('/api/table/tbl_1/record')
    expect(Object.fromEntries(request().url.searchParams)).toEqual({
      filter,
      take: '25',
      skip: '50',
      viewId: 'viw_1',
      fieldKeyType: 'id',
      cellFormat: 'text',
    })
  })
})

describe('teable records.get', () => {
  it('gets one record from Teable\'s singular record route', async () => {
    const request = captureFetch({ id: 'rec_1', fields: { fld_1: 'Ada' } })

    await teableConnector.executeRead!({
      source: source(),
      capabilityName: 'records.get',
      args: { tableId: 'tbl_1', recordId: 'rec_1', fieldKeyType: 'id', cellFormat: 'json' },
      idempotencyKey: 'k-record-get',
    })

    expect(request().method).toBe('GET')
    expect(request().url.pathname).toBe('/api/table/tbl_1/record/rec_1')
    expect(Object.fromEntries(request().url.searchParams)).toEqual({
      fieldKeyType: 'id',
      cellFormat: 'json',
    })
  })
})

describe('teable records.update', () => {
  it('nests fields under the required record envelope', async () => {
    const request = captureFetch({ id: 'rec_1', fields: { Name: 'Grace' } })

    const result = await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.update',
      args: {
        tableId: 'tbl_1',
        recordId: 'rec_1',
        fields: { Name: 'Grace' },
        fieldKeyType: 'name',
        typecast: false,
      },
      idempotencyKey: 'k-record-update',
    })

    expect(result.status).toBe('committed')
    expect(request().method).toBe('PATCH')
    expect(request().url.href).toBe('https://app.teable.ai/api/table/tbl_1/record/rec_1')
    expect(request().body).toEqual({
      record: { fields: { Name: 'Grace' } },
      fieldKeyType: 'name',
      typecast: false,
    })
  })
})

describe('teable tables.list', () => {
  it('lists tables from the base table route', async () => {
    const request = captureFetch([{ id: 'tbl_1', name: 'Tasks' }])

    const result = await teableConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: { baseId: 'bse_1' },
      idempotencyKey: 'k-table-list',
    })

    expect(result.data).toEqual([{ id: 'tbl_1', name: 'Tasks' }])
    expect(request().method).toBe('GET')
    expect(request().url.href).toBe('https://app.teable.ai/api/base/bse_1/table')
  })

  it('reports expired credentials on 401', async () => {
    captureFetch({ message: 'Unauthorized' }, 401)

    await expect(
      teableConnector.executeRead!({
        source: source(),
        capabilityName: 'tables.list',
        args: { baseId: 'bse_1' },
        idempotencyKey: 'k-table-list-unauthorized',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('teable tables.create', () => {
  it('creates a table under the selected base', async () => {
    const request = captureFetch({ id: 'tbl_new', name: 'Inbox' }, 201)

    await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: { baseId: 'bse_1', name: 'Inbox' },
      idempotencyKey: 'k-table-create',
    })

    expect(request().method).toBe('POST')
    expect(request().url.href).toBe('https://app.teable.ai/api/base/bse_1/table')
    expect(request().body).toEqual({ name: 'Inbox' })
  })
})

describe('teable fields.create', () => {
  it('creates a field under the selected table', async () => {
    const request = captureFetch({ id: 'fld_1', name: 'Priority', type: 'singleSelect' }, 201)

    await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'fields.create',
      args: { tableId: 'tbl_1', name: 'Priority', type: 'singleSelect' },
      idempotencyKey: 'k-field-create',
    })

    expect(request().method).toBe('POST')
    expect(request().url.href).toBe('https://app.teable.ai/api/table/tbl_1/field')
    expect(request().body).toEqual({ name: 'Priority', type: 'singleSelect' })
  })
})

describe('teable views.create', () => {
  it('creates a view under the selected table', async () => {
    const request = captureFetch({ id: 'viw_1', name: 'My Grid', type: 'grid' }, 201)

    await teableConnector.executeMutation!({
      source: source(),
      capabilityName: 'views.create',
      args: { tableId: 'tbl_1', name: 'My Grid', type: 'grid' },
      idempotencyKey: 'k-view-create',
    })

    expect(request().method).toBe('POST')
    expect(request().url.href).toBe('https://app.teable.ai/api/table/tbl_1/view')
    expect(request().body).toEqual({ name: 'My Grid', type: 'grid' })
  })
})
