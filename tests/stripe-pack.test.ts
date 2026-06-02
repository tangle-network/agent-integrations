import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  stripePackConnector,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(): ResolvedDataSource {
  return {
    id: 'src_stripe_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'stripe-pack',
    label: 'Acme Stripe',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'rk_test_abc' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('stripe-pack payments + refunds + customers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest now includes create_payment_intent, create_refund, create_customer', () => {
    const names = stripePackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('create_payment_intent')
    expect(names).toContain('create_refund')
    expect(names).toContain('create_customer')
  })

  // create_payment_intent

  it('create_payment_intent POSTs to /v1/payment_intents with form body and forwards idempotency key', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init!.method!
      capturedHeaders = init!.headers as Record<string, string>
      capturedBody = String(init!.body)
      return jsonResponse({
        id: 'pi_123',
        client_secret: 'pi_123_secret_abc',
        status: 'requires_payment_method',
        amount: 2000,
        currency: 'usd',
        customer: 'cus_1',
      })
    }))

    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_payment_intent',
      args: {
        amount: 2000,
        currency: 'USD',
        customer: 'cus_1',
        automatic_payment_methods: { enabled: true },
        description: 'Order #42',
        metadata: { orderId: '42' },
      },
      idempotencyKey: 'idemp-pi-1',
    })

    expect(capturedUrl).toBe('https://api.stripe.com/v1/payment_intents')
    expect(capturedMethod).toBe('POST')
    expect(capturedHeaders['authorization']).toBe('Bearer rk_test_abc')
    expect(capturedHeaders['content-type']).toBe('application/x-www-form-urlencoded')
    expect(capturedHeaders['idempotency-key']).toBe('idemp-pi-1')
    expect(capturedBody).toContain('amount=2000')
    expect(capturedBody).toContain('currency=usd')
    expect(capturedBody).toContain('customer=cus_1')
    expect(capturedBody).toContain('automatic_payment_methods%5Benabled%5D=true')
    expect(capturedBody).toContain('description=Order')
    expect(capturedBody).toContain('metadata%5BorderId%5D=42')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({
      paymentIntentId: 'pi_123',
      clientSecret: 'pi_123_secret_abc',
      status: 'requires_payment_method',
      amount: 2000,
      currency: 'usd',
      customer: 'cus_1',
    })
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
  })

  it('create_payment_intent rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_payment_intent',
        args: { currency: 'usd' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`amount` is required/)
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_payment_intent',
        args: { amount: 1000 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`currency` is required/)
  })

  it('create_payment_intent surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_payment_intent',
        args: { amount: 1000, currency: 'usd' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('create_payment_intent surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_payment_intent',
        args: { amount: 1000, currency: 'usd' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // create_refund

  it('create_refund POSTs to /v1/refunds with payment_intent + amount + reason', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init!.headers as Record<string, string>
      capturedBody = String(init!.body)
      return jsonResponse({
        id: 're_1',
        status: 'succeeded',
        amount: 1500,
        currency: 'usd',
        payment_intent: 'pi_123',
        charge: 'ch_456',
        reason: 'requested_by_customer',
      })
    }))

    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_refund',
      args: {
        payment_intent: 'pi_123',
        amount: 1500,
        reason: 'requested_by_customer',
      },
      idempotencyKey: 'idemp-refund-1',
    })

    expect(capturedUrl).toBe('https://api.stripe.com/v1/refunds')
    expect(capturedHeaders['idempotency-key']).toBe('idemp-refund-1')
    expect(capturedBody).toContain('payment_intent=pi_123')
    expect(capturedBody).toContain('amount=1500')
    expect(capturedBody).toContain('reason=requested_by_customer')
    expect(capturedBody).not.toContain('charge=')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({
      refundId: 're_1',
      status: 'succeeded',
      amount: 1500,
      currency: 'usd',
      paymentIntent: 'pi_123',
      reason: 'requested_by_customer',
    })
  })

  it('create_refund accepts charge instead of payment_intent', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init!.body)
      return jsonResponse({ id: 're_2', status: 'succeeded', charge: 'ch_xyz' })
    }))

    await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_refund',
      args: { charge: 'ch_xyz' },
      idempotencyKey: 'k',
    })
    expect(capturedBody).toContain('charge=ch_xyz')
    expect(capturedBody).not.toContain('payment_intent=')
  })

  it('create_refund rejects when neither payment_intent nor charge is provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_refund',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`payment_intent` or `charge` is required/)
  })

  it('create_refund rejects when both payment_intent AND charge are provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_refund',
        args: { payment_intent: 'pi_1', charge: 'ch_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`payment_intent` OR `charge`, not both/)
  })

  it('create_refund surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_refund',
        args: { payment_intent: 'pi_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // create_customer

  it('create_customer POSTs to /v1/customers with form body and forwards idempotency key', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init!.headers as Record<string, string>
      capturedBody = String(init!.body)
      return jsonResponse({
        id: 'cus_1',
        email: 'a@b.com',
        name: 'Drew',
        phone: '+15555555555',
        description: 'VIP',
      })
    }))

    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_customer',
      args: {
        email: 'a@b.com',
        name: 'Drew',
        phone: '+15555555555',
        description: 'VIP',
        metadata: { tier: 'gold' },
      },
      idempotencyKey: 'idemp-cust-1',
    })

    expect(capturedUrl).toBe('https://api.stripe.com/v1/customers')
    expect(capturedHeaders['idempotency-key']).toBe('idemp-cust-1')
    expect(capturedBody).toContain('email=a%40b.com')
    expect(capturedBody).toContain('name=Drew')
    expect(capturedBody).toContain('phone=%2B15555555555')
    expect(capturedBody).toContain('description=VIP')
    expect(capturedBody).toContain('metadata%5Btier%5D=gold')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({
      customerId: 'cus_1',
      email: 'a@b.com',
      name: 'Drew',
      phone: '+15555555555',
      description: 'VIP',
    })
    expect(result.idempotentReplay).toBe(false)
  })

  it('create_customer succeeds with no args (all fields optional)', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init!.body)
      return jsonResponse({ id: 'cus_empty' })
    }))

    const result = await stripePackConnector.executeMutation!({
      source: source(),
      capabilityName: 'create_customer',
      args: {},
      idempotencyKey: 'k',
    })
    expect(capturedBody).toBe('')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toMatchObject({ customerId: 'cus_empty' })
  })

  it('create_customer surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_customer',
        args: { email: 'a@b.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('create_customer surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      stripePackConnector.executeMutation!({
        source: source(),
        capabilityName: 'create_customer',
        args: { email: 'a@b.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
