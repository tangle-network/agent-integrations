import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  circleConnector,
  instagramBusinessConnector,
  mastodonConnector,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index.js'
import type {
  ConnectorCredentials,
  ResolvedDataSource,
} from '../src/connectors/types.js'

const activatedProviders = [
  'instagram-business',
  'linkedin',
  'mastodon',
  'circle',
  'youtube',
  'tiktok',
] as const

afterEach(() => vi.unstubAllGlobals())

describe('social and community provider factories', () => {
  it('activates six executable providers with actions', () => {
    for (const kind of activatedProviders) {
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

  it('uses exact OAuth app environment mappings and fails closed', () => {
    const expected = {
      'instagram-business': {
        clientId: [
          'INSTAGRAM_BUSINESS_OAUTH_CLIENT_ID',
          'FACEBOOK_OAUTH_CLIENT_ID',
        ],
        clientSecret: [
          'INSTAGRAM_BUSINESS_OAUTH_CLIENT_SECRET',
          'FACEBOOK_OAUTH_CLIENT_SECRET',
        ],
      },
      linkedin: {
        clientId: 'LINKEDIN_OAUTH_CLIENT_ID',
        clientSecret: 'LINKEDIN_OAUTH_CLIENT_SECRET',
      },
      tiktok: {
        clientId: 'TIKTOK_OAUTH_CLIENT_KEY',
        clientSecret: 'TIKTOK_OAUTH_CLIENT_SECRET',
      },
      youtube: {
        clientId: 'GOOGLE_OAUTH_CLIENT_ID',
        clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
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

  it('accepts the shared Facebook app as the Instagram OAuth fallback', () => {
    const definition = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'instagram-business',
    )!
    expect(
      resolveConnectorAdapterFactoryOptions(definition, {
        FACEBOOK_OAUTH_CLIENT_ID: 'facebook-client',
        FACEBOOK_OAUTH_CLIENT_SECRET: 'facebook-secret',
      }),
    ).toEqual({
      clientId: 'facebook-client',
      clientSecret: 'facebook-secret',
    })
  })

  it('keeps customer-token providers independent of deployment secrets', () => {
    for (const kind of ['mastodon', 'circle']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      expect(definition.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition, {}), kind).toEqual({})
    }
  })

  it('keeps catalog-only and auth-mismatched social providers hidden', () => {
    for (const kind of [
      'facebook-pages',
      'facebook-leads',
      'bluesky',
      'pinterest',
    ]) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})

describe('social provider credential placement', () => {
  it('sends Circle tokens with the provider-required Token prefix', async () => {
    let headers: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        headers = init?.headers as Record<string, string>
        return new Response('{}', { status: 200 })
      }),
    )

    await expect(circleConnector.test(source('circle'))).resolves.toEqual({
      ok: true,
    })
    expect(headers.Authorization).toBe('Token customer-api-key')
  })

  it('uses connection metadata for the Instagram health-check account id', async () => {
    let requestUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return new Response('{}', { status: 200 })
      }),
    )

    await expect(
      instagramBusinessConnector.test(
        source(
          'instagram-business',
          { igUserId: 'ig_123' },
          { kind: 'oauth2', accessToken: 'instagram-access-token' },
        ),
      ),
    ).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe(
      'https://graph.facebook.com/v21.0/ig_123?fields=id%2Cusername&access_token=instagram-access-token',
    )
  })

  it('fails before the network when Instagram account metadata is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      instagramBusinessConnector.test(
        source(
          'instagram-business',
          {},
          { kind: 'oauth2', accessToken: 'instagram-access-token' },
        ),
      ),
    ).resolves.toEqual({
      ok: false,
      reason: 'missing required argument: connection.igUserId',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Mastodon federated-host restrictions', () => {
  it('rejects local, private, credential-bearing, and non-HTTPS hosts', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    for (const baseUrl of [
      'http://mastodon.social',
      'https://localhost',
      'https://social.internal',
      'https://admin:secret@social.example.com',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://100.64.0.1',
      'https://169.254.169.254',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://[::1]',
      'https://[::ffff:127.0.0.1]',
      'https://2130706433',
      'file:///etc/passwd',
    ]) {
      await expect(
        mastodonConnector.test(source('mastodon', { baseUrl })),
        baseUrl,
      ).resolves.toEqual({
        ok: false,
        reason: 'connection base URL must be a public HTTPS endpoint',
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a federated public HTTPS host', async () => {
    let requestUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return new Response('{}', { status: 200 })
      }),
    )

    await expect(
      mastodonConnector.test(
        source('mastodon', { baseUrl: 'https://social.example.com' }),
      ),
    ).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe(
      'https://social.example.com/api/v1/accounts/verify_credentials',
    )
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
