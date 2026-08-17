import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import { mycaseConnector } from '../src/connectors/adapters/mycase.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/registry.js'
import { listTangleIntegrationContracts } from '../src/tangle-catalog.js'

function source(): ResolvedDataSource {
  return {
    id: 'source_mycase',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'mycase',
    label: 'MyCase test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'mycase-token' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('MyCase legal provider pack', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registers the OAuth application and canonicalizes the upstream package id', () => {
    const auth = mycaseConnector.manifest.auth
    expect(auth).toMatchObject({
      kind: 'oauth2',
      authorizationUrl: 'https://auth.mycase.com/login_sessions/new',
      tokenUrl: 'https://auth.mycase.com/tokens',
      scopes: [],
      sendScopeParam: false,
    })

    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'mycase')
    expect(factory?.envMap).toEqual({
      clientId: 'MYCASE_OAUTH_CLIENT_ID',
      clientSecret: 'MYCASE_OAUTH_CLIENT_SECRET',
    })

    expect(getIntegrationSpec('mycase-piece')).toMatchObject({
      kind: 'mycase',
      status: 'executable',
    })
    expect(listTangleIntegrationContracts().find((contract) => contract.id === 'mycase-piece'))
      .toMatchObject({ implementation: { kind: 'native_adapter' }, status: 'native_backed' })
  })

  it('covers cases, contacts, leads, firm reference data, work, billing activity, and notes', () => {
    const names = new Set(mycaseConnector.manifest.capabilities.map((capability) => capability.name))
    for (const name of [
      'cases.list', 'cases.create', 'cases.update',
      'clients.list', 'clients.create', 'clients.update',
      'companies.list', 'companies.create', 'companies.update',
      'leads.list', 'leads.create', 'staff.list',
      'case-stages.list', 'practice-areas.list', 'referral-sources.list',
      'events.list', 'events.create', 'tasks.list', 'tasks.create',
      'calls.list', 'calls.create', 'time-entries.list', 'time-entries.create',
      'expenses.list', 'expenses.create', 'case-notes.create',
      'client-notes.create', 'company-notes.create', 'custom-fields.create',
    ]) expect(names.has(name), name).toBe(true)

    for (const capability of mycaseConnector.manifest.capabilities) {
      if (capability.class === 'mutation') expect(capability.externalEffect).toBe(true)
    }
  })

  it('sends incremental case filters to the documented API v1 endpoint', async () => {
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ cases: [] })
    }))

    await mycaseConnector.executeRead!({
      source: source(),
      capabilityName: 'cases.list',
      args: { page_size: 50, updated_after: '2026-07-01T00:00:00Z', status: 'open' },
      idempotencyKey: 'mycase-cases-1',
    })

    const url = new URL(requestUrl)
    expect(url.origin + url.pathname).toBe('https://external-integrations.mycase.com/v1/cases')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('updated_after')).toBe('2026-07-01T00:00:00Z')
    expect(url.searchParams.get('status')).toBe('open')
    expect(authorization).toBe('Bearer mycase-token')
  })

  it('unwraps provider-native update data without leaking the path id', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 42, name: 'Acme v2' })
    }))

    const result = await mycaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'companies.update',
      args: { id: '42', data: { name: 'Acme v2' } },
      idempotencyKey: 'mycase-company-42',
    })

    expect(requestUrl).toBe('https://external-integrations.mycase.com/v1/companies/42')
    expect(requestMethod).toBe('PUT')
    expect(requestBody).toEqual({ name: 'Acme v2' })
    expect(result.status).toBe('committed')
  })

  it('reports revoked OAuth credentials distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(mycaseConnector.test(source())).resolves.toEqual({
      ok: false,
      reason: 'MyCase rejected credentials (401)',
    })
  })
})
