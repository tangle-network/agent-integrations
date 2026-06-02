import { afterEach, describe, expect, it, vi } from 'vitest'
import { chargebeeConnector } from '../src/connectors/adapters/chargebee.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chargebee_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chargebee',
    label: 'Chargebee test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { siteBaseUrl: 'https://acme-test.chargebee.com' },
    credentials: { kind: 'api-key', apiKey: 'base64-encoded-key' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('chargebee adapter manifest', () => {
  it('classifies itself as the crm category and exposes the chargebee kind', () => {
    expect(chargebeeConnector.manifest.kind).toBe('chargebee')
    expect(chargebeeConnector.manifest.category).toBe('crm')
    expect(chargebeeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chargebeeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new lifecycle/refund writes', () => {
    const names = chargebeeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customer.create',
        'customer.get',
        'invoice.refund',
        'subscription.cancel',
        'subscription.create',
        'subscription.pause',
        'subscription.resume',
        'subscription.update',
      ].sort(),
    )
    const reads = chargebeeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chargebeeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customer.get'])
    expect(mutations).toEqual(
      [
        'customer.create',
        'invoice.refund',
        'subscription.cancel',
        'subscription.create',
        'subscription.pause',
        'subscription.resume',
        'subscription.update',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of chargebeeConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('chargebee subscription.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/subscriptions/{id}/update_for_items', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ subscription: { id: 'sub_1', status: 'active' } })
      }),
    )
    const result = await chargebeeConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscription.update',
      args: {
        subscription_id: 'sub_1',
        item_price_id: 'price_pro',
        quantity: 2,
        billing_cycles: 12,
        replace_items_list: true,
        trial_end: 1719446400,
        end_of_term: false,
        prorate: true,
        coupon_ids: ['LAUNCH50'],
        po_number: 'PO-1',
        invoice_immediately: false,
        invoice_notes: 'mid-cycle upgrade',
        meta_data: { source: 'admin' },
      },
      idempotencyKey: 'k-sub-upd-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(
      'https://acme-test.chargebee.com/api/v2/subscriptions/sub_1/update_for_items',
    )
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      chargebeeConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscription.update',
        args: {
          subscription_id: 'sub_1',
          item_price_id: 'price_pro',
          quantity: 1,
          billing_cycles: 1,
          replace_items_list: false,
          trial_end: 0,
          end_of_term: false,
          prorate: true,
          coupon_ids: [],
          po_number: '',
          invoice_immediately: false,
          invoice_notes: '',
          meta_data: {},
        },
        idempotencyKey: 'k-sub-upd-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chargebee subscription.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/subscriptions/{id}/pause with the pause options', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ subscription: { id: 'sub_1', status: 'paused' } })
      }),
    )
    const result = await chargebeeConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscription.pause',
      args: {
        subscription_id: 'sub_1',
        pause_option: 'immediately',
        pause_date: 1719446400,
        resume_date: 1722124800,
        unbilled_charges_handling: 'invoice',
        invoice_dunning_handling: 'stop_dunning',
      },
      idempotencyKey: 'k-pause-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(
      'https://acme-test.chargebee.com/api/v2/subscriptions/sub_1/pause',
    )
    expect(capturedBody).toEqual({
      pause_option: 'immediately',
      pause_date: 1719446400,
      resume_date: 1722124800,
      unbilled_charges_handling: 'invoice',
      invoice_dunning_handling: 'stop_dunning',
    })
    expect(result.status).toBe('committed')
  })
})

describe('chargebee subscription.resume', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/subscriptions/{id}/resume with resume options', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ subscription: { id: 'sub_1', status: 'active' } })
      }),
    )
    const result = await chargebeeConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscription.resume',
      args: {
        subscription_id: 'sub_1',
        resume_option: 'immediately',
        resume_date: 1722124800,
        charges_handling: 'invoice_immediately',
        unpaid_invoices_handling: 'schedule_payment_collection',
      },
      idempotencyKey: 'k-resume-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(
      'https://acme-test.chargebee.com/api/v2/subscriptions/sub_1/resume',
    )
    expect(capturedBody).toEqual({
      resume_option: 'immediately',
      resume_date: 1722124800,
      charges_handling: 'invoice_immediately',
      unpaid_invoices_handling: 'schedule_payment_collection',
    })
    expect(result.status).toBe('committed')
  })
})

describe('chargebee invoice.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v2/invoices/{id}/refund with refund amount', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ invoice: { id: 'inv_1', status: 'refunded' } })
      }),
    )
    const result = await chargebeeConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoice.refund',
      args: {
        invoice_id: 'inv_1',
        refund_amount: 5000,
        comment: 'Refund for downtime',
        customer_notes: 'Apologies for the outage',
        credit_note_reason_code: 'service_unsatisfactory',
      },
      idempotencyKey: 'k-refund-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(
      'https://acme-test.chargebee.com/api/v2/invoices/inv_1/refund',
    )
    expect(capturedBody).toEqual({
      refund_amount: 5000,
      comment: 'Refund for downtime',
      customer_notes: 'Apologies for the outage',
      'credit_note[reason_code]': 'service_unsatisfactory',
    })
    expect(result.status).toBe('committed')
  })
})
