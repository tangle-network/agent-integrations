import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  builtwithConnector,
  CONNECTOR_ADAPTER_FACTORIES,
  fullenrichConnector,
  hunterConnector,
  neverbounceConnector,
  resolveConnectorAdapterFactoryOptions,
  theirstackConnector,
  zerobounceConnector,
} from '../src/connectors/adapters/index.js'
import type {
  ConnectorAdapter,
  ResolvedDataSource,
} from '../src/connectors/types.js'

const activatedProviders = [
  'builtwith',
  'fullenrich',
  'hunter',
  'neverbounce',
  'theirstack',
  'zerobounce',
] as const

afterEach(() => vi.unstubAllGlobals())

describe('enrichment and research provider factories', () => {
  it('activates six customer-funded providers with real health checks', () => {
    for (const kind of activatedProviders) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition?.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
      expect(definition?.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })

  it('keeps adapters without a safe account health check hidden', () => {
    for (const kind of ['cognism', 'crustdata', 'lusha', 'proxycurl']) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})

describe('enrichment provider credential placement', () => {
  it.each([
    [fullenrichConnector, 'fullenrich', 'https://app.fullenrich.com/api/v2/account/credits'],
    [theirstackConnector, 'theirstack', 'https://api.theirstack.com/v0/billing/credit-balance'],
  ] as const)(
    'sends %s credentials only in the bearer header',
    async (adapter: ConnectorAdapter, kind, expectedUrl) => {
      let requestUrl = ''
      let headers = new Headers()
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        headers = new Headers(init?.headers)
        return new Response('{}', { status: 200 })
      }))

      await expect(adapter.test(source(kind))).resolves.toEqual({ ok: true })
      expect(requestUrl).toBe(expectedUrl)
      expect(headers.get('authorization')).toBe('Bearer customer-api-key')
      expect(requestUrl).not.toContain('customer-api-key')
    },
  )

  it.each([
    [
      builtwithConnector,
      'builtwith',
      'https://api.builtwith.com/v22/free1/api.json?LOOKUP=builtwith.com&KEY=customer-api-key',
    ],
    [
      hunterConnector,
      'hunter',
      'https://api.hunter.io/v2/account?api_key=customer-api-key',
    ],
    [
      neverbounceConnector,
      'neverbounce',
      'https://api.neverbounce.com/v4.2/account/info?key=customer-api-key',
    ],
    [
      zerobounceConnector,
      'zerobounce',
      'https://api.zerobounce.net/v2/getcredits?api_key=customer-api-key',
    ],
  ] as const)(
    'places the %s API key in the documented query parameter',
    async (adapter: ConnectorAdapter, kind, expectedUrl) => {
      let requestUrl = ''
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return new Response('{}', { status: 200 })
      }))

      await expect(adapter.test(source(kind))).resolves.toEqual({ ok: true })
      expect(requestUrl).toBe(expectedUrl)
    },
  )
})

function source(kind: string): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'customer-api-key' },
    status: 'active',
  }
}
