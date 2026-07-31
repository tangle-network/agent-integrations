import { afterEach, describe, expect, it, vi } from 'vitest'
import { avalaraConnector } from '../src/connectors/adapters/avalara.js'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import { taxjarConnector } from '../src/connectors/adapters/taxjar.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/registry.js'

function source(kind: 'avalara' | 'taxjar', overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: `${kind} test`,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: kind === 'avalara'
      ? { kind: 'api-key', apiKey: JSON.stringify({ accountId: '123', licenseKey: 'license-secret' }) }
      : { kind: 'api-key', apiKey: 'taxjar-secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('tax provider factories and setup', () => {
  it('registers both customer-credential adapters without deployment secrets', () => {
    for (const kind of ['avalara', 'taxjar']) {
      const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(factory?.envMap, kind).toEqual({})
      expect(getIntegrationSpec(kind)).toMatchObject({ kind, status: 'executable' })
    }
  })

  it('keeps every transaction-record mutation approval-required', () => {
    for (const connector of [avalaraConnector, taxjarConnector]) {
      for (const capability of connector.manifest.capabilities) {
        if (capability.class === 'mutation') expect(capability.externalEffect).toBe(true)
      }
    }
  })
})

describe('Avalara AvaTax', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes the account id and license key as HTTP Basic credentials', async () => {
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ rate: 0.0875 })
    }))

    await avalaraConnector.executeRead!({
      source: source('avalara', { metadata: { apiBaseUrl: 'https://sandbox-rest.avatax.com' } }),
      capabilityName: 'rates.by-address',
      args: { postalCode: '94105', country: 'US', region: 'CA' },
      idempotencyKey: 'avalara-rate-1',
    })

    expect(new URL(requestUrl).origin).toBe('https://sandbox-rest.avatax.com')
    expect(authorization).toBe(`Basic ${Buffer.from('123:license-secret').toString('base64')}`)
  })

  it('rejects credential forwarding to an unapproved AvaTax host', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(avalaraConnector.test(source('avalara', {
      metadata: { apiBaseUrl: 'https://rest.avatax.com.attacker.test' },
    }))).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed on malformed or incomplete credential bundles', async () => {
    for (const apiKey of [
      'not-json',
      JSON.stringify({ accountId: '123' }),
      JSON.stringify({ licenseKey: 'secret' }),
      JSON.stringify({ accountId: '', licenseKey: 'secret' }),
    ]) {
      await expect(avalaraConnector.test(source('avalara', {
        credentials: { kind: 'api-key', apiKey },
      }))).resolves.toMatchObject({ ok: false })
    }
  })

  it('redacts both structured credential values from provider errors', async () => {
    const authorization = `Basic ${Buffer.from('123:license-secret').toString('base64')}`
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `account 123 rejected license license-secret via ${authorization}`,
      { status: 500 },
    )))

    await expect(avalaraConnector.executeRead!({
      source: source('avalara'),
      capabilityName: 'companies.list',
      args: {},
      idempotencyKey: 'avalara-error-1',
    })).rejects.toSatisfy((error: unknown) => {
      const message = String(error)
      return message.includes('[REDACTED]')
        && !message.includes('license-secret')
        && !message.includes('account 123')
        && !message.includes(authorization)
    })
  })

  it('unwraps provider-native transaction models without leaking path arguments', async () => {
    let requestUrl = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ code: 'INV-1', status: 'Committed' })
    }))

    await avalaraConnector.executeMutation!({
      source: source('avalara'),
      capabilityName: 'transactions.commit',
      args: {
        companyCode: 'DEFAULT',
        transactionCode: 'INV-1',
        model: { commit: true },
      },
      idempotencyKey: 'avalara-commit-1',
    })

    expect(requestUrl).toBe(
      'https://rest.avatax.com/api/v2/companies/DEFAULT/transactions/INV-1/commit',
    )
    expect(requestBody).toEqual({ commit: true })
  })
})

describe('TaxJar', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses TaxJar quoted-token auth for non-mutating tax calculation', async () => {
    let requestMethod = ''
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestMethod = init?.method ?? ''
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ tax: { amount_to_collect: 8.75 } })
    }))

    const result = await taxjarConnector.executeRead!({
      source: source('taxjar'),
      capabilityName: 'taxes.calculate',
      args: {
        from_country: 'US', from_zip: '94105',
        to_country: 'US', to_zip: '10001', amount: 100, shipping: 0,
      },
      idempotencyKey: 'taxjar-calc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.taxjar.com/v2/taxes')
    expect(authorization).toBe('Token token="taxjar-secret"')
    expect(result.data).toMatchObject({ tax: { amount_to_collect: 8.75 } })
  })

  it('updates an order without leaking the path id into the provider payload', async () => {
    let requestUrl = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ order: { transaction_id: 'order-1' } })
    }))

    await taxjarConnector.executeMutation!({
      source: source('taxjar'),
      capabilityName: 'orders.update',
      args: {
        transactionId: 'order-1',
        data: { transaction_id: 'order-1', amount: 100, shipping: 0, sales_tax: 8.75 },
      },
      idempotencyKey: 'taxjar-order-1',
    })

    expect(requestUrl).toBe('https://api.taxjar.com/v2/transactions/orders/order-1')
    expect(requestBody).toEqual({
      transaction_id: 'order-1', amount: 100, shipping: 0, sales_tax: 8.75,
    })
  })

  it('redacts the quoted token from provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'invalid token taxjar-secret',
      { status: 500 },
    )))

    await expect(taxjarConnector.executeRead!({
      source: source('taxjar'),
      capabilityName: 'categories.list',
      args: {},
      idempotencyKey: 'taxjar-error-1',
    })).rejects.toSatisfy((error: unknown) => {
      const message = String(error)
      return message.includes('[REDACTED]') && !message.includes('taxjar-secret')
    })
  })
})
