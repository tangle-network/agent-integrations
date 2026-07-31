import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import { recurlyConnector } from '../src/connectors/adapters/recurly.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'source_recurly',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'recurly',
    label: 'Recurly test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'private-key' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Recurly adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ships the billing lifecycle pack and registers without shared credentials', () => {
    expect(recurlyConnector.manifest.kind).toBe('recurly')
    expect(recurlyConnector.manifest.auth.kind).toBe('api-key')

    const names = recurlyConnector.manifest.capabilities.map((capability) => capability.name)
    expect(names).toEqual(expect.arrayContaining([
      'sites.list',
      'accounts.list',
      'accounts.get',
      'accounts.create',
      'accounts.update',
      'plans.list',
      'subscriptions.list',
      'accounts.subscriptions.list',
      'subscriptions.get',
      'subscriptions.create',
      'subscriptions.cancel',
      'subscriptions.reactivate',
      'subscriptions.terminate',
      'invoices.list',
      'invoices.get',
      'accounts.invoices.list',
    ]))

    for (const capability of recurlyConnector.manifest.capabilities) {
      if (capability.class === 'mutation') expect(capability.externalEffect).toBe(true)
    }

    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'recurly')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({})).toBe(recurlyConnector)
  })

  it('uses Recurly v3 Basic auth and API media type on reads', async () => {
    let requestUrl = ''
    let requestHeaders = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      return jsonResponse({ data: [{ id: 'sub_1' }] })
    }))

    await recurlyConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.subscriptions.list',
      args: { accountId: 'code-acme', state: 'active', limit: 25 },
      idempotencyKey: 'recurly-list-1',
    })

    const url = new URL(requestUrl)
    expect(url.origin + url.pathname).toBe('https://v3.recurly.com/accounts/code-acme/subscriptions')
    expect(url.searchParams.get('state')).toBe('active')
    expect(requestHeaders.get('authorization')).toBe(
      `Basic ${Buffer.from('private-key:').toString('base64')}`,
    )
    expect(requestHeaders.get('accept')).toBe('application/vnd.recurly.v2021-02-25')
  })

  it('creates a subscription without leaking path-only arguments into the JSON body', async () => {
    let requestMethod = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 'sub_1', state: 'active' }, 201)
    }))

    const result = await recurlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.create',
      args: {
        plan_code: 'pro',
        currency: 'USD',
        account: { code: 'acme' },
        quantity: 2,
      },
      idempotencyKey: 'recurly-create-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestBody).toEqual({
      plan_code: 'pro',
      currency: 'USD',
      account: { code: 'acme' },
      quantity: 2,
    })
    expect(result.status).toBe('committed')
  })

  it('keeps the subscription id out of lifecycle request bodies', async () => {
    let requestUrl = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 'sub_1', state: 'canceled' })
    }))

    await recurlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { subscriptionId: 'sub_1' },
      idempotencyKey: 'recurly-cancel-1',
    })

    expect(requestUrl).toBe('https://v3.recurly.com/subscriptions/sub_1/cancel')
    expect(requestBody).toEqual({})
  })

  it('reports revoked credentials distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)))

    await expect(recurlyConnector.test(source())).resolves.toEqual({
      ok: false,
      reason: 'Recurly rejected credentials (401)',
    })
  })
})
