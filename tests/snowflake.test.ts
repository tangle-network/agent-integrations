import { afterEach, describe, expect, it, vi } from 'vitest'
import { snowflakeConnector } from '../src/connectors/adapters/snowflake.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const ACCOUNT_URL = 'https://xy12345.us-east-1.snowflakecomputing.com'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_snowflake_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'snowflake',
    label: 'snowflake test',
    consistencyModel: 'authoritative',
    scopes: ['refresh_token'],
    metadata: { accountUrl: ACCOUNT_URL },
    credentials: { kind: 'oauth2', accessToken: 'snow_token' },
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

describe('snowflake adapter manifest', () => {
  it('uses account-scoped OAuth endpoints and the refresh-token scope', () => {
    expect(snowflakeConnector.manifest.kind).toBe('snowflake')
    expect(snowflakeConnector.manifest.category).toBe('database')
    expect(snowflakeConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = snowflakeConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    expect(auth.authorizationUrl).toBe('{accountUrl}/oauth/authorize')
    expect(auth.tokenUrl).toBe('{accountUrl}/oauth/token-request')
    expect(auth.scopes).toEqual(['refresh_token'])
    expect(auth.tokenClientAuthMethod).toBe('client_secret_post')
    expect(auth.pkce).toBe('supported')
    expect(auth.urlTemplateMetadata).toEqual({
      accountUrl: {
        kind: 'base-url',
        allowedBaseUrlSuffixes: ['.snowflakecomputing.com'],
      },
    })
  })

  it('exposes only the SQL API operations the runtime can execute truthfully', () => {
    expect(snowflakeConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'queries.run',
      'queries.runMultiple',
      'statements.get',
      'statements.cancel',
    ])

    const byName = Object.fromEntries(
      snowflakeConnector.manifest.capabilities.map((capability) => [capability.name, capability]),
    )
    expect(byName['statements.get']?.class).toBe('read')
    for (const name of ['queries.run', 'queries.runMultiple', 'statements.cancel']) {
      const capability = byName[name]
      expect(capability?.class).toBe('mutation')
      if (capability?.class !== 'mutation') throw new Error(`${name} must require approval`)
      expect(capability.cas).toBe('none')
      expect(capability.externalEffect).toBe(true)
    }
  })
})

describe('snowflake SQL API execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runs one approved SQL statement against the selected account', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init }
      return jsonResponse({ statementHandle: '01b123' })
    }))

    const result = await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'queries.run',
      args: {
        statement: 'SELECT * FROM EVENTS WHERE ID = ?',
        timeout: 30,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        warehouse: 'COMPUTE_WH',
        role: 'ANALYST',
        bindings: { '1': { type: 'FIXED', value: '42' } },
        async: true,
      },
      idempotencyKey: 'snow-1',
    })

    expect(result.status).toBe('committed')
    expect(captured?.url).toBe(`${ACCOUNT_URL}/api/v2/statements?async=true`)
    expect(captured?.init?.method).toBe('POST')
    expect(captured?.init?.headers).toMatchObject({
      authorization: 'Bearer snow_token',
      'content-type': 'application/json',
      'x-snowflake-authorization-token-type': 'OAUTH',
    })
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      statement: 'SELECT * FROM EVENTS WHERE ID = ?',
      timeout: 30,
      database: 'ANALYTICS',
      schema: 'PUBLIC',
      warehouse: 'COMPUTE_WH',
      role: 'ANALYST',
      bindings: { '1': { type: 'FIXED', value: '42' } },
    })
  })

  it('runs multiple statements with Snowflake MULTI_STATEMENT_COUNT', async () => {
    let requestBody: unknown
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({ statementHandles: ['01b123', '01b124'] })
    }))

    await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'queries.runMultiple',
      args: {
        statement: 'CREATE TEMP TABLE T (ID NUMBER); INSERT INTO T VALUES (1)',
        multiStatementCount: '2',
      },
      idempotencyKey: 'snow-2',
    })

    expect(requestUrl).toBe(`${ACCOUNT_URL}/api/v2/statements`)
    expect(requestBody).toEqual({
      statement: 'CREATE TEMP TABLE T (ID NUMBER); INSERT INTO T VALUES (1)',
      parameters: { MULTI_STATEMENT_COUNT: '2' },
    })
  })

  it('gets a statement result partition', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init }
      return jsonResponse({ statementHandle: '01b123', data: [['42']] })
    }))

    const result = await snowflakeConnector.executeRead!({
      source: source(),
      capabilityName: 'statements.get',
      args: { statementHandle: '01b123', partition: 2 },
      idempotencyKey: 'snow-3',
    })

    expect(captured?.url).toBe(`${ACCOUNT_URL}/api/v2/statements/01b123?partition=2`)
    expect(captured?.init?.method).toBe('GET')
    expect(captured?.init?.body).toBeUndefined()
    expect(result.data).toEqual({ statementHandle: '01b123', data: [['42']] })
  })

  it('cancels a statement with an empty JSON body', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init }
      return jsonResponse({ statementHandle: '01b123', statementStatusUrl: '/status' })
    }))

    await snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'statements.cancel',
      args: { statementHandle: '01b123' },
      idempotencyKey: 'snow-4',
    })

    expect(captured?.url).toBe(`${ACCOUNT_URL}/api/v2/statements/01b123/cancel`)
    expect(captured?.init?.method).toBe('POST')
    expect(captured?.init?.body).toBe('{}')
  })

  it('probes the account with a harmless identity SELECT', async () => {
    let requestBody: unknown
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({ data: [['XY12345', 'DREW', 'SYSADMIN']] })
    }))

    await expect(snowflakeConnector.test(source())).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe(`${ACCOUNT_URL}/api/v2/statements`)
    expect(requestBody).toEqual({
      statement: 'SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_ROLE()',
    })
  })

  it.each([
    'https://snowflake.example.test',
    'https://xy12345.us-east-1.snowflakecomputing.com:8443',
    'https://user:secret@xy12345.us-east-1.snowflakecomputing.com',
  ])('fails before provider traffic for an unsafe account root: %s', async (accountUrl) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(snowflakeConnector.executeMutation!({
      source: source({ metadata: { accountUrl } }),
      capabilityName: 'queries.run',
      args: { statement: 'SELECT 1' },
      idempotencyKey: 'snow-5',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces expired OAuth credentials on a real SQL operation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    await expect(snowflakeConnector.executeMutation!({
      source: source(),
      capabilityName: 'queries.run',
      args: { statement: 'SELECT 1' },
      idempotencyKey: 'snow-6',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
