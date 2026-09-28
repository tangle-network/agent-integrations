import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorAdapterProvider,
  docusignConnector,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_docusign',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'docusign',
  status: 'active',
  grantedScopes: ['signature'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('docusign declarative adapter', () => {
  it('tests the configured account instead of requiring action arguments', async () => {
    const fetchMock = mockFetch({ accountId: 'acc_42' })

    await expect(docusignConnector.test(sourceFor(connection))).resolves.toEqual({ ok: true })

    const [url] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://na4.docusign.net/restapi/v2.1/accounts/acc_42')
  })

  it('envelope.send PUTs the status=sent transition', async () => {
    const fetchMock = mockFetch({ envelopeId: 'env_1', status: 'sent' })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'envelope.send',
      input: { accountId: 'acc_42', envelopeId: 'env_1' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://na4.docusign.net/restapi/v2.1/accounts/acc_42/envelopes/env_1')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'sent' })
  })

  it('envelope.void PUTs status=voided with voidedReason', async () => {
    const fetchMock = mockFetch({ envelopeId: 'env_1', status: 'voided' })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'envelope.void',
      input: { accountId: 'acc_42', envelopeId: 'env_1', voidedReason: 'customer cancelled' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://na4.docusign.net/restapi/v2.1/accounts/acc_42/envelopes/env_1')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'voided', voidedReason: 'customer cancelled' })
  })

  it('recipient.resendInvitation forces resend_envelope=true on the query', async () => {
    const fetchMock = mockFetch({ recipientUpdateResults: [] })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'recipient.resendInvitation',
      input: {
        accountId: 'acc_42',
        envelopeId: 'env_1',
        signers: [{ recipientId: '1', email: 'signer@example.com', name: 'Ada' }],
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain(
      'https://na4.docusign.net/restapi/v2.1/accounts/acc_42/envelopes/env_1/recipients',
    )
    expect(String(url)).toContain('resend_envelope=true')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      signers: [{ recipientId: '1', email: 'signer@example.com', name: 'Ada' }],
    })
  })

  it('routes envelopes.list through the per-account base URI with bearer auth', async () => {
    const fetchMock = mockFetch({ envelopes: [{ envelopeId: 'env_1', status: 'sent' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'envelopes.list',
      input: { accountId: 'acc_42', from_date: '2026-01-01T00:00:00Z', status: 'sent,completed', count: 25 },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('https://na4.docusign.net/restapi/v2.1/accounts/acc_42/envelopes')
    expect(String(url)).toContain('from_date=2026-01-01T00%3A00%3A00Z')
    expect(String(url)).toContain('count=25')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer ds_token_1' })
  })

  it('forwards the envelope create payload verbatim and POSTs to the right path', async () => {
    const fetchMock = mockFetch({ envelopeId: 'env_new', status: 'sent' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'envelopes.create',
      input: {
        accountId: 'acc_42',
        emailSubject: 'Please sign',
        status: 'sent',
        templateId: 'tpl_1',
        templateRoles: [{ email: 'signer@example.com', name: 'Ada', roleName: 'Signer' }],
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://na4.docusign.net/restapi/v2.1/accounts/acc_42/envelopes')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body).toMatchObject({
      emailSubject: 'Please sign',
      status: 'sent',
      templateId: 'tpl_1',
      templateRoles: [{ email: 'signer@example.com', name: 'Ada', roleName: 'Signer' }],
    })
  })

  it('falls back to the demo host when metadata.baseUri is absent', async () => {
    const fetchMock = mockFetch({ envelope: { envelopeId: 'env_1' } })
    const provider = createConnectorAdapterProvider({
      adapters: [docusignConnector],
      resolveDataSource: () => ({ ...sourceFor(connection), metadata: {} }),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'envelopes.get',
      input: { accountId: 'acc_42', envelopeId: 'env_1' },
    })

    const [url] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('https://demo.docusign.net/restapi/v2.1/accounts/acc_42/envelopes/env_1')
  })
})

function sourceFor(conn: IntegrationConnection): ResolvedDataSource {
  return {
    id: `source_${conn.connectorId}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: conn.connectorId,
    label: conn.connectorId,
    consistencyModel: 'authoritative',
    scopes: ['signature'],
    metadata: { baseUri: 'https://na4.docusign.net', accountId: 'acc_42' },
    credentials: { kind: 'oauth2', accessToken: 'ds_token_1' },
    status: 'active',
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
