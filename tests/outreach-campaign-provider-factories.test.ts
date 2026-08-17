import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
  smartleadConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const expectedProviders = {
  outreach: ['OUTREACH_OAUTH_CLIENT_ID', 'OUTREACH_OAUTH_CLIENT_SECRET'],
  salesloft: ['SALESLOFT_OAUTH_CLIENT_ID', 'SALESLOFT_OAUTH_CLIENT_SECRET'],
  mailchimp: ['MAILCHIMP_OAUTH_CLIENT_ID', 'MAILCHIMP_OAUTH_CLIENT_SECRET'],
  marketo: ['MARKETO_OAUTH_CLIENT_ID', 'MARKETO_OAUTH_CLIENT_SECRET'],
  klaviyo: ['KLAVIYO_OAUTH_CLIENT_ID', 'KLAVIYO_OAUTH_CLIENT_SECRET'],
  apollo: [],
  'customer-io': [],
  braze: [],
  smartlead: [],
  lemlist: [],
} as const

describe('outreach and campaign provider factories', () => {
  it('registers all ten direct adapters with their exact deployment requirements', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap), kind).toEqual(envNames)
      expect(definition!.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })

  it('fails closed for OAuth apps and accepts customer-supplied API keys', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)!
      if (envNames.length === 0) {
        expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toEqual({})
      } else {
        expect(resolveConnectorAdapterFactoryOptions(definition, { [envNames[0]]: 'client-id-only' }), kind).toBeNull()
      }
    }
  })
})

describe('Smartlead API-key placement', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the customer key in api_key rather than an unsupported bearer header', async () => {
    let requestUrl = ''
    let authorization: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization')
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await smartleadConnector.test(source())
    expect(requestUrl).toBe('https://api.smartlead.io/v1/campaigns?api_key=customer-key')
    expect(authorization).toBeNull()
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'source_smartlead',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'smartlead',
    label: 'Smartlead',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'customer-key' },
    status: 'active',
  }
}
