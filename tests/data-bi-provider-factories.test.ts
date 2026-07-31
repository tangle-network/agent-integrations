import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  airtableConnector,
  CONNECTOR_ADAPTER_FACTORIES,
  datadogConnector,
  firebaseConnector,
  googleBigqueryConnector,
  hightouchConnector,
  metabaseConnector,
  resolveConnectorAdapterFactoryOptions,
  segmentConnector,
} from '../src/connectors/adapters/index.js'
import type {
  ConnectorAdapter,
  ResolvedDataSource,
} from '../src/connectors/types.js'
import { getIntegrationSpec, resolveConnectorAuthSpec } from '../src/specs/index.js'

function source(
  kind: string,
  metadata: Record<string, unknown>,
  credentials: ResolvedDataSource['credentials'],
): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials,
    status: 'active',
  }
}

describe('data warehouse, database, and BI provider factories', () => {
  it('registers Google data providers through existing Google application settings', () => {
    const bigQuery = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'google-bigquery',
    )
    const firebase = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'firebase',
    )

    expect(bigQuery?.envMap).toEqual({
      clientId: 'GOOGLE_OAUTH_CLIENT_ID',
      clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
    })
    expect(firebase?.envMap).toEqual({
      clientId: ['FIREBASE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'],
      clientSecret: [
        'FIREBASE_OAUTH_CLIENT_SECRET',
        'GOOGLE_OAUTH_CLIENT_SECRET',
      ],
    })
    expect(resolveConnectorAdapterFactoryOptions(firebase!, {
      GOOGLE_OAUTH_CLIENT_ID: 'google-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    })).toEqual({ clientId: 'google-client', clientSecret: 'google-secret' })
  })

  it('maps the catalog BigQuery id onto the executable Google adapter', () => {
    const spec = getIntegrationSpec('bigquery')

    expect(spec).toMatchObject({
      kind: 'google-bigquery',
      status: 'executable',
    })
    expect(spec?.actions.length).toBeGreaterThan(0)
    expect(resolveConnectorAuthSpec('bigquery')).toMatchObject({
      authKind: 'oauth2',
      clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    })
  })

  it('fails closed on partial Supabase OAuth settings', () => {
    const supabase = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'supabase',
    )

    expect(supabase?.envMap).toEqual({
      clientId: 'SUPABASE_OAUTH_CLIENT_ID',
      clientSecret: 'SUPABASE_OAUTH_CLIENT_SECRET',
    })
    expect(resolveConnectorAdapterFactoryOptions(supabase!, {
      SUPABASE_OAUTH_CLIENT_ID: 'client-id-only',
    })).toBeNull()
  })

  it('registers customer-token data providers without shared deployment secrets', () => {
    for (const kind of [
      'airtable',
      'segment',
      'hightouch',
      'datadog',
      'metabase',
    ]) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition?.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
      expect(definition?.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })

  it('keeps invalid, retired, and absent provider adapters out of the executable inventory', () => {
    const executableKinds = new Set(
      CONNECTOR_ADAPTER_FACTORIES.map((definition) => definition.kind),
    )

    for (const kind of [
      'snowflake',
      'postgres',
      'mongodb',
      'tableau',
      'mysql',
      'redshift',
      'databricks',
      'looker',
    ]) {
      expect(executableKinds.has(kind), kind).toBe(false)
    }
    expect(executableKinds.has('microsoft-power-bi')).toBe(true)
  })
})

describe('data provider credential and endpoint boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [airtableConnector, 'airtable', {}],
    [segmentConnector, 'segment', {}],
    [hightouchConnector, 'hightouch', {}],
    [datadogConnector, 'datadog', { intakeUrl: 'https://api.datadoghq.com' }],
    [metabaseConnector, 'metabase', { baseUrl: 'https://analytics.example.com' }],
  ] as const)('rejects an empty %s API key before making a network request', async (
    adapter: ConnectorAdapter,
    kind,
    metadata,
  ) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(adapter.test(source(
      kind,
      metadata,
      { kind: 'api-key', apiKey: '' },
    ))).resolves.toEqual({
      ok: false,
      reason: 'declarative REST connectors require a non-empty API key',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses connection metadata for Google provider health checks', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const credentials = { kind: 'oauth2', accessToken: 'access-token' } as const
    await expect(googleBigqueryConnector.test(source(
      'google-bigquery',
      { projectId: 'tangle-data' },
      credentials,
    ))).resolves.toEqual({ ok: true })
    await expect(firebaseConnector.test(source(
      'firebase',
      { projectId: 'tangle-app' },
      credentials,
    ))).resolves.toEqual({ ok: true })

    expect(urls).toEqual([
      'https://bigquery.googleapis.com/bigquery/v2/projects/tangle-data/datasets',
      'https://firestore.googleapis.com/v1/projects/tangle-app/databases/(default)/documents',
    ])
  })

  it('sends Metabase credentials only in the provider API-key header', async () => {
    let headers = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(metabaseConnector.test(source(
      'metabase',
      { baseUrl: 'https://analytics.example.com' },
      { kind: 'api-key', apiKey: 'metabase-secret' },
    ))).resolves.toEqual({ ok: true })
    expect(headers.get('x-api-key')).toBe('metabase-secret')
    expect(headers.has('authorization')).toBe(false)
  })

  it('sends Hightouch credentials as a bearer token to its fixed API host', async () => {
    let requestUrl = ''
    let headers = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      headers = new Headers(init?.headers)
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(hightouchConnector.test(source(
      'hightouch',
      {},
      { kind: 'api-key', apiKey: 'hightouch-secret' },
    ))).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://api.hightouch.com/api/v1/syncs')
    expect(headers.get('authorization')).toBe('Bearer hightouch-secret')
  })

  it('allows documented Datadog regions and rejects lookalike hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const credentials = { kind: 'api-key', apiKey: 'datadog-secret' } as const
    await expect(datadogConnector.test(source(
      'datadog',
      { intakeUrl: 'https://api.us3.datadoghq.com' },
      credentials,
    ))).resolves.toEqual({ ok: true })
    await expect(datadogConnector.test(source(
      'datadog',
      { intakeUrl: 'https://api.us3.datadoghq.com.attacker.test' },
      credentials,
    ))).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
  })
})
