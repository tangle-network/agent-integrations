import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  freshdeskConnector,
  gorgiasConnector,
  resolveConnectorAdapterFactoryOptions,
  zendeskConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorAdapter, ResolvedDataSource } from '../src/connectors/types.js'

const expectedProviders = {
  front: ['FRONT_OAUTH_CLIENT_ID', 'FRONT_OAUTH_CLIENT_SECRET'],
  zendesk: ['ZENDESK_OAUTH_CLIENT_ID', 'ZENDESK_OAUTH_CLIENT_SECRET'],
  intercom: ['INTERCOM_OAUTH_CLIENT_ID', 'INTERCOM_OAUTH_CLIENT_SECRET'],
  helpscout: ['HELPSCOUT_OAUTH_CLIENT_ID', 'HELPSCOUT_OAUTH_CLIENT_SECRET'],
  freshdesk: ['FRESHDESK_OAUTH_CLIENT_ID', 'FRESHDESK_OAUTH_CLIENT_SECRET'],
  gorgias: ['GORGIAS_OAUTH_CLIENT_ID', 'GORGIAS_OAUTH_CLIENT_SECRET'],
} as const

function source(kind: string, subdomainUrl: string): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { subdomainUrl },
    credentials: { kind: 'oauth2', accessToken: 'access-token' },
    status: 'active',
  }
}

describe('shared inbox and support provider factories', () => {
  it('registers all six providers behind their exact OAuth application settings', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap), kind).toEqual(envNames)
      expect(definition!.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })

  it('fails closed when only half of an OAuth application is configured', () => {
    for (const [kind, envNames] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)!
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [envNames[0]]: 'client-id-only',
      }), kind).toBeNull()
    }
  })
})

describe('support tenant URL boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [zendeskConnector, 'zendesk', 'https://acme.zendesk.com', 'https://acme.zendesk.com/api/v2/users/me.json'],
    [freshdeskConnector, 'freshdesk', 'https://acme.freshdesk.com', 'https://acme.freshdesk.com/api/v2/agents/me'],
    [gorgiasConnector, 'gorgias', 'https://acme.gorgias.com', 'https://acme.gorgias.com/api/users/0'],
  ] as const)('allows %s tenant hosts and blocks lookalike hosts', async (adapter: ConnectorAdapter, kind, baseUrl, expectedUrl) => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(adapter.test(source(kind, baseUrl))).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe(expectedUrl)

    await expect(adapter.test(source(kind, `${baseUrl}.attacker.test`))).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
  })
})
