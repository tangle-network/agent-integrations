import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  biginByZohoConnector,
  fireberryConnector,
  flowluConnector,
  freshsalesConnector,
  insightlyConnector,
  microsoftDynamicsCrmConnector,
  ninjapipeConnector,
  pipedriveConnector,
  resolveConnectorAdapterFactoryOptions,
  salesforceConnector,
  zohoCrmConnector,
} from '../src/connectors/adapters/index.js'
import type {
  ConnectorAdapter,
  ConnectorCredentials,
  ResolvedDataSource,
} from '../src/connectors/types.js'

const activatedCrms = [
  'twenty',
  'folk',
  'freshsales',
  'capsule-crm',
  'insightly',
  'bigin-by-zoho',
  'fireberry',
  'flowlu',
  'lead-connector',
  'ninjapipe',
] as const

afterEach(() => vi.unstubAllGlobals())

describe('complete CRM provider factory pack', () => {
  it('activates ten additional executable CRM adapters with actions', () => {
    for (const kind of activatedCrms) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(
        definition!.factory({}).manifest.capabilities.length,
        kind,
      ).toBeGreaterThan(0)
    }
  })

  it('uses exact shared OAuth app environment names and fails closed', () => {
    const expected = {
      'capsule-crm': {
        clientId: 'CAPSULE_CRM_OAUTH_CLIENT_ID',
        clientSecret: 'CAPSULE_CRM_OAUTH_CLIENT_SECRET',
      },
      // Bigin has its own OAuth client rather than the shared Zoho app, so it
      // reads its own env names — exact, like every other entry here.
      'bigin-by-zoho': {
        clientId: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
        clientSecret: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
      },
      'lead-connector': {
        clientId: 'LEAD_CONNECTOR_OAUTH_CLIENT_ID',
        clientSecret: 'LEAD_CONNECTOR_OAUTH_CLIENT_SECRET',
      },
    } as const

    for (const [kind, envMap] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      expect(definition.envMap, kind).toEqual(envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toBeNull()
    }
  })

  it('keeps customer API-key CRMs independent of deployment secrets', () => {
    for (const kind of [
      'twenty',
      'folk',
      'freshsales',
      'insightly',
      'fireberry',
      'flowlu',
      'ninjapipe',
    ]) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      expect(definition.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toEqual({})
    }
  })

  it('keeps catalog-only and known-invalid CRM surfaces hidden', () => {
    for (const kind of [
      'salesflare',
      'nutshell',
      'teamleader',
      'vtiger',
      'lofty',
      'zendesk-sell',
    ]) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})

describe('CRM credential placement', () => {
  it('sends each provider API key in its documented authentication scheme', async () => {
    const observed: Record<string, string>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        observed.push(init?.headers as Record<string, string>)
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    await expect(
      freshsalesConnector.test(
        source('freshsales', { bundleUrl: 'https://acme.myfreshworks.com' }),
      ),
    ).resolves.toEqual({ ok: true })
    await expect(
      insightlyConnector.test(
        source('insightly', { apiUrl: 'https://api.na1.insightly.com/v3.1' }),
      ),
    ).resolves.toEqual({ ok: true })
    await expect(fireberryConnector.test(source('fireberry'))).resolves.toEqual({
      ok: true,
    })
    await expect(
      ninjapipeConnector.test(
        source('ninjapipe', { base_url: 'https://www.ninjapipe.app/api' }),
      ),
    ).resolves.toEqual({ ok: true })

    expect(observed[0]!.Authorization).toBe('Token token=customer-api-key')
    expect(observed[1]!.authorization).toBe('Basic Y3VzdG9tZXItYXBpLWtleTo=')
    expect(observed[2]!.tokenid).toBe('customer-api-key')
    expect(observed[3]!.Authorization).toBe('Bearer customer-api-key')
  })
})

describe('CRM tenant endpoint restrictions', () => {
  const tenantAdapters: readonly [
    ConnectorAdapter,
    string,
    Record<string, unknown>,
    ConnectorCredentials,
  ][] = [
    [
      salesforceConnector,
      'salesforce',
      { instanceUrl: 'https://acme.my.salesforce.com.attacker.test' },
      { kind: 'oauth2', accessToken: 'token' },
    ],
    [
      pipedriveConnector,
      'pipedrive',
      { apiDomain: 'https://acme.pipedrive.com.attacker.test' },
      { kind: 'oauth2', accessToken: 'token' },
    ],
    [
      zohoCrmConnector,
      'zoho-crm',
      { apiDomain: 'https://www.zohoapis.eu.attacker.test' },
      { kind: 'oauth2', accessToken: 'token' },
    ],
    [
      microsoftDynamicsCrmConnector,
      'microsoft-dynamics-crm',
      { instanceUrl: 'https://acme.crm.dynamics.com.attacker.test' },
      { kind: 'oauth2', accessToken: 'token' },
    ],
    [
      freshsalesConnector,
      'freshsales',
      { bundleUrl: 'https://acme.myfreshworks.com.attacker.test' },
      { kind: 'api-key', apiKey: 'customer-api-key' },
    ],
    [
      insightlyConnector,
      'insightly',
      { apiUrl: 'https://api.na1.insightly.com.attacker.test/v3.1' },
      { kind: 'api-key', apiKey: 'customer-api-key' },
    ],
    [
      biginByZohoConnector,
      'bigin-by-zoho',
      { apiDomain: 'https://www.zohoapis.com.au.attacker.test' },
      { kind: 'oauth2', accessToken: 'token' },
    ],
    [
      flowluConnector,
      'flowlu',
      { baseUrl: 'https://acme.flowlu.com.attacker.test/api/v1' },
      { kind: 'api-key', apiKey: 'customer-api-key' },
    ],
    [
      ninjapipeConnector,
      'ninjapipe',
      { base_url: 'https://www.ninjapipe.app.attacker.test/api' },
      { kind: 'api-key', apiKey: 'customer-api-key' },
    ],
  ]

  it('rejects lookalike tenant hosts before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const [adapter, kind, metadata, credentials] of tenantAdapters) {
      await expect(
        adapter.test(source(kind, metadata, credentials)),
        kind,
      ).resolves.toEqual({
        ok: false,
        reason: 'connection base URL is not an allowed provider endpoint',
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts provider-owned HTTPS tenant hosts', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    for (const [adapter, kind, metadata, credentials] of tenantAdapters) {
      const providerMetadata = Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [
          key,
          typeof value === 'string' ? value.replace('.attacker.test', '') : value,
        ]),
      )
      await expect(
        adapter.test(source(kind, providerMetadata, credentials)),
        kind,
      ).resolves.toEqual({ ok: true })
    }
    expect(fetchMock).toHaveBeenCalledTimes(tenantAdapters.length)
  })
})

function source(
  kind: string,
  metadata: Record<string, unknown> = {},
  credentials: ConnectorCredentials = {
    kind: 'api-key',
    apiKey: 'customer-api-key',
  },
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
