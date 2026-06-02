import { afterEach, describe, expect, it, vi } from 'vitest'
import { typeformConnector } from '../typeform.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_typeform',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'typeform',
  label: 'typeform',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'tf_token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('typeform adapter', () => {
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(typeformConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares oauth2 against api.typeform.com with typeform-shaped env names and offline scope for refresh', () => {
    const auth = typeformConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth.kind narrowing failed')
    expect(auth.authorizationUrl).toBe('https://api.typeform.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.typeform.com/oauth/token')
    // `offline` is required to receive a refresh token; the others are the resource:read|write tuples.
    expect(auth.scopes).toEqual([
      'forms:read',
      'forms:write',
      'responses:read',
      'webhooks:read',
      'webhooks:write',
      'workspaces:read',
      'accounts:read',
      'offline',
    ])
    expect(auth.clientIdEnv).toBe('TYPEFORM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('TYPEFORM_OAUTH_CLIENT_SECRET')
  })

  it('exposes the forms + responses + webhooks + workspaces action surface with the right read/mutation split', () => {
    expect(typeformConnector.manifest.kind).toBe('typeform')
    expect(typeformConnector.manifest.displayName).toBe('Typeform')
    expect(typeformConnector.manifest.category).toBe('other')
    const names = typeformConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'account.get',
      'forms.create',
      'forms.delete',
      'forms.get',
      'forms.list',
      'forms.update',
      'images.create',
      'responses.delete',
      'responses.list',
      'themes.list',
      'webhooks.delete',
      'webhooks.get',
      'webhooks.list',
      'webhooks.upsert',
      'workspaces.list',
    ])
    const readers = typeformConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = typeformConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual([
      'account.get',
      'forms.get',
      'forms.list',
      'responses.list',
      'themes.list',
      'webhooks.get',
      'webhooks.list',
      'workspaces.list',
    ])
    expect(mutators).toEqual([
      'forms.create',
      'forms.delete',
      'forms.update',
      'images.create',
      'responses.delete',
      'webhooks.delete',
      'webhooks.upsert',
    ])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeformConnector.executeRead).toBeTypeOf('function')
    expect(typeformConnector.executeMutation).toBeTypeOf('function')
  })

  it('lists responses against /forms/{form_id}/responses with bearer auth and only the provided query params', async () => {
    const fetchMock = mockFetch({ items: [], total_items: 0, page_count: 0 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'responses.list',
      args: { form_id: 'form_abc', page_size: 50, since: '2026-05-01T00:00:00Z' },
      idempotencyKey: 'responses_1',
    }

    await typeformConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.typeform.com')
    expect(url.pathname).toBe('/forms/form_abc/responses')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('since')).toBe('2026-05-01T00:00:00Z')
    // Unsupplied filters must be omitted from the URL — declarative-REST must not send `until=` empty.
    expect(url.searchParams.has('until')).toBe(false)
    expect(url.searchParams.has('before')).toBe(false)
    expect(url.searchParams.has('after')).toBe(false)
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tf_token_xyz' })
  })

  it('upserts a webhook via PUT against the tag-scoped path and forwards the body fields', async () => {
    const fetchMock = mockFetch({ id: 'wh_1', form_id: 'form_abc', tag: 'crm-fanout', url: 'https://hooks.example.com/typeform' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'webhooks.upsert',
      args: {
        form_id: 'form_abc',
        tag: 'crm-fanout',
        url: 'https://hooks.example.com/typeform',
        enabled: true,
        secret: 'shared-secret',
        verify_ssl: true,
      },
      idempotencyKey: 'wh_upsert_1',
    }

    const result = await typeformConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/forms/form_abc/webhooks/crm-fanout')
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tf_token_xyz',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://hooks.example.com/typeform',
      enabled: true,
      secret: 'shared-secret',
      verify_ssl: true,
    })
  })

  it('deletes responses via DELETE with the included_tokens query param', async () => {
    const fetchMock = mockFetch({}, { status: 200 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'responses.delete',
      args: { form_id: 'form_abc', included_tokens: 'tok_1,tok_2' },
      idempotencyKey: 'delete_1',
    }

    const result = await typeformConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/forms/form_abc/responses')
    expect(url.searchParams.get('included_tokens')).toBe('tok_1,tok_2')
    expect(init.method).toBe('DELETE')
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
