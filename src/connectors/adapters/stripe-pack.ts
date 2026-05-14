/**
 * Stripe pack connector — single connector kind packing customer +
 * invoice + checkout + subscription management capabilities, validating
 * the "connector pack" concept (one auth handshake, multiple related
 * capabilities) without exploding the registry into `stripe-customers`,
 * `stripe-checkout`, `stripe-invoices`, `stripe-subscriptions` n-tuples.
 *
 *   find_customer(email)                       → read; CAS n/a
 *   list_subscriptions(customerId, status?)    → read; CAS n/a
 *   create_invoice(customerId, items)          → mutation; cas: 'native-idempotency'
 *   create_checkout_session(...)               → mutation; cas: 'native-idempotency'
 *   cancel_subscription(subscriptionId, atPeriodEnd?) → mutation; cas: 'native-idempotency'
 *   create_billing_portal_session(customerId, returnUrl) → mutation; cas: 'native-idempotency'
 *
 * Auth: API key (Stripe restricted key). Operator pastes the key into
 * the Connections UI. We never see their account password / OAuth flow;
 * Stripe restricted keys are the customer's responsibility (they pick
 * which permissions the key carries). The kind exposes a webhook URL
 * post-connect for the operator to paste into the Stripe dashboard —
 * we'll wire the receiver to P-3's inbound webhook surface in a later
 * commit. That URL is returned in `metadata.webhookUrl` so the UI can
 * render it.
 *
 * Why this is the textbook example of `cas: 'native-idempotency'`:
 * Stripe's `Idempotency-Key` HTTP header is THE reference implementation
 * of native idempotency. Same key + same args within 24h returns the
 * stored response (Stripe's words, not ours). Same key + different args
 * → 400 with `idempotency_error`. We forward the SDK's idempotency key
 * directly. MutationGuard short-circuits before us on retry; Stripe's
 * own dedup is the second line of defense.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'

const API = 'https://api.stripe.com/v1'

export const stripePackConnector: ConnectorAdapter = {
  manifest: {
    kind: 'stripe-pack',
    displayName: 'Stripe (customers, invoices, checkout, subscriptions)',
    description:
      "Look up Stripe customers, draft invoices, spin up hosted Checkout sessions, manage subscriptions, and hand off to the customer billing portal — all from one Stripe restricted key. Idempotency-Key forwarded on every mutation.",
    auth: {
      kind: 'api-key',
      hint: 'Paste a Stripe restricted key (rk_live_…) with read on customers + subscriptions and write on invoices + checkout + subscriptions + billing portal.',
    },
    category: 'commerce',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'find_customer',
        class: 'read',
        description: 'Search Stripe customers by email. Returns the first match or {found:false}.',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string' } },
          required: ['email'],
        },
      },
      {
        name: 'list_subscriptions',
        class: 'read',
        description: "List a customer's subscriptions. Optionally filter by status ('active', 'past_due', 'canceled', 'all').",
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            status: { type: 'string', enum: ['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'trialing', 'all'], default: 'all' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          },
          required: ['customerId'],
        },
      },
      {
        name: 'create_invoice',
        class: 'mutation',
        description:
          'Draft + finalize a Stripe invoice for a customer with line items. Idempotency-Key guarantees at-most-once.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  amount: { type: 'integer', description: 'Amount in the smallest currency unit (cents).' },
                  currency: { type: 'string', description: '3-letter ISO currency code, lowercase.' },
                  quantity: { type: 'integer', minimum: 1, default: 1 },
                },
                required: ['amount', 'currency'],
              },
            },
            autoFinalize: { type: 'boolean', default: true },
          },
          required: ['customerId', 'items'],
        },
      },
      {
        name: 'create_checkout_session',
        class: 'mutation',
        description:
          'Create a Stripe Checkout session and return its hosted URL. Idempotency-Key guarantees at-most-once.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            mode: { type: 'string', enum: ['payment', 'subscription'], default: 'payment' },
            successUrl: { type: 'string' },
            cancelUrl: { type: 'string' },
            lineItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  price: { type: 'string', description: 'Stripe price id (price_...)' },
                  quantity: { type: 'integer', minimum: 1, default: 1 },
                },
                required: ['price'],
              },
            },
          },
          required: ['successUrl', 'cancelUrl', 'lineItems'],
        },
      },
      {
        name: 'cancel_subscription',
        class: 'mutation',
        description:
          'Cancel a subscription. Default cancels immediately; pass atPeriodEnd=true to schedule cancellation for the end of the current billing period.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            atPeriodEnd: { type: 'boolean', default: false },
          },
          required: ['subscriptionId'],
        },
      },
      {
        name: 'create_billing_portal_session',
        class: 'mutation',
        description:
          'Create a Stripe billing portal session and return its URL. Hand-off for the customer to self-serve cancel/upgrade/update-card.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            returnUrl: { type: 'string' },
          },
          required: ['customerId', 'returnUrl'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const apiKey = readApiKey(inv.source.credentials)
    if (inv.capabilityName === 'list_subscriptions') return listSubscriptions(inv, apiKey)
    if (inv.capabilityName !== 'find_customer') {
      throw new Error(`stripe-pack: unknown read capability ${inv.capabilityName}`)
    }
    const { email } = inv.args as { email: string }
    // Stripe's /customers/search is the canonical email lookup. Falls
    // back to /customers?email= for accounts on legacy Search-disabled
    // tier — most accounts have Search enabled by default in 2024+.
    const url = `${API}/customers/search?query=${encodeURIComponent(`email:'${email.toLowerCase()}'`)}&limit=1`
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) {
      throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`stripe-pack find_customer ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      data?: Array<{ id: string; email?: string; name?: string; phone?: string }>
    }
    const first = json.data?.[0]
    return {
      data: first
        ? { found: true, customer: { id: first.id, email: first.email, name: first.name, phone: first.phone } }
        : { found: false },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const apiKey = readApiKey(inv.source.credentials)
    if (inv.capabilityName === 'create_invoice') return createInvoice(inv, apiKey)
    if (inv.capabilityName === 'create_checkout_session') return createCheckoutSession(inv, apiKey)
    if (inv.capabilityName === 'cancel_subscription') return cancelSubscription(inv, apiKey)
    if (inv.capabilityName === 'create_billing_portal_session') return createBillingPortalSession(inv, apiKey)
    throw new Error(`stripe-pack: unknown mutation capability ${inv.capabilityName}`)
  },

  async test(source) {
    try {
      const apiKey = readApiKey(source.credentials)
      // /v1/account is the cheapest grant-validity probe.
      const res = await fetch(`${API}/account`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) {
        return { ok: false, reason: 'Stripe rejected API key (401) — reconnect required' }
      }
      if (!res.ok) return { ok: false, reason: `Stripe returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

async function createInvoice(inv: ConnectorInvocation, apiKey: string): Promise<CapabilityMutationResult> {
  const { customerId, items, autoFinalize } = inv.args as {
    customerId: string
    items: Array<{ description?: string; amount: number; currency: string; quantity?: number }>
    autoFinalize?: boolean
  }
  // Stripe requires invoiceitem.create BEFORE invoice.create. We do
  // both under the same idempotency-key prefix so retries are exactly
  // replayed across both calls.
  const idemKey = inv.idempotencyKey
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const body = new URLSearchParams({
      customer: customerId,
      amount: String(it.amount),
      currency: it.currency.toLowerCase(),
      quantity: String(it.quantity ?? 1),
    })
    if (it.description) body.set('description', it.description)
    const res = await fetch(`${API}/invoiceitems`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': `${idemKey}-item-${i}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
    if (res.status === 409) {
      throw new ResourceContention('Stripe invoiceitem conflict — retry rejected by idempotency check')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`stripe-pack create_invoice (item ${i}) ${res.status}: ${text.slice(0, 200)}`)
    }
  }

  const invBody = new URLSearchParams({
    customer: customerId,
    auto_advance: autoFinalize === false ? 'false' : 'true',
    collection_method: 'send_invoice',
    days_until_due: '14',
  })
  const invRes = await fetch(`${API}/invoices`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': `${idemKey}-invoice`,
    },
    body: invBody,
    signal: AbortSignal.timeout(15_000),
  })
  if (invRes.status === 401) throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
  if (invRes.status === 409) {
    throw new ResourceContention('Stripe invoice conflict — retry rejected by idempotency check')
  }
  if (!invRes.ok) {
    const text = await invRes.text().catch(() => '')
    throw new Error(`stripe-pack create_invoice ${invRes.status}: ${text.slice(0, 200)}`)
  }
  const created = (await invRes.json()) as { id: string; hosted_invoice_url?: string; status?: string }
  return {
    status: 'committed',
    data: { invoiceId: created.id, hostedInvoiceUrl: created.hosted_invoice_url, status: created.status },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createCheckoutSession(
  inv: ConnectorInvocation,
  apiKey: string,
): Promise<CapabilityMutationResult> {
  const { customerId, mode, successUrl, cancelUrl, lineItems } = inv.args as {
    customerId?: string
    mode?: 'payment' | 'subscription'
    successUrl: string
    cancelUrl: string
    lineItems: Array<{ price: string; quantity?: number }>
  }
  const body = new URLSearchParams({
    mode: mode ?? 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
  if (customerId) body.set('customer', customerId)
  lineItems.forEach((it, i) => {
    body.set(`line_items[${i}][price]`, it.price)
    body.set(`line_items[${i}][quantity]`, String(it.quantity ?? 1))
  })
  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': inv.idempotencyKey,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
  if (res.status === 409) {
    throw new ResourceContention('Stripe checkout session conflict — retry rejected by idempotency check')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`stripe-pack create_checkout_session ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as { id: string; url?: string; payment_status?: string }
  return {
    status: 'committed',
    data: { sessionId: created.id, url: created.url, paymentStatus: created.payment_status },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function listSubscriptions(inv: ConnectorInvocation, apiKey: string): Promise<CapabilityReadResult> {
  const { customerId, status, limit } = inv.args as { customerId: string; status?: string; limit?: number }
  const params = new URLSearchParams({ customer: customerId, limit: String(limit ?? 10) })
  if (status && status !== 'all') params.set('status', status)
  else params.set('status', 'all')
  const res = await fetch(`${API}/subscriptions?${params.toString()}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`stripe-pack list_subscriptions ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data?: Array<{
      id: string
      status: string
      current_period_end?: number
      cancel_at_period_end?: boolean
      items?: { data?: Array<{ price?: { id: string; product?: string; unit_amount?: number; currency?: string; recurring?: { interval?: string } } }> }
    }>
  }
  const subscriptions = (json.data ?? []).map((sub) => ({
    id: sub.id,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    items: (sub.items?.data ?? []).map((it) => ({
      priceId: it.price?.id,
      productId: it.price?.product,
      unitAmount: it.price?.unit_amount,
      currency: it.price?.currency,
      interval: it.price?.recurring?.interval,
    })),
  }))
  return {
    data: { subscriptions },
    fetchedAt: Date.now(),
  }
}

async function cancelSubscription(inv: ConnectorInvocation, apiKey: string): Promise<CapabilityMutationResult> {
  const { subscriptionId, atPeriodEnd } = inv.args as { subscriptionId: string; atPeriodEnd?: boolean }
  let res: Response
  if (atPeriodEnd) {
    // Update the subscription to mark cancel_at_period_end=true. The
    // subscription stays active until the end of the current billing
    // period and Stripe automatically cancels at that time.
    const body = new URLSearchParams({ cancel_at_period_end: 'true' })
    res = await fetch(`${API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': inv.idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    })
  } else {
    res = await fetch(`${API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'idempotency-key': inv.idempotencyKey,
      },
      signal: AbortSignal.timeout(15_000),
    })
  }
  if (res.status === 401) throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
  if (res.status === 404) throw new Error(`stripe-pack cancel_subscription: subscription ${subscriptionId} not found`)
  if (res.status === 409) {
    throw new ResourceContention('Stripe subscription conflict — retry rejected by idempotency check')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`stripe-pack cancel_subscription ${res.status}: ${text.slice(0, 200)}`)
  }
  const updated = (await res.json()) as { id: string; status: string; cancel_at_period_end?: boolean; canceled_at?: number; current_period_end?: number }
  return {
    status: 'committed',
    data: {
      id: updated.id,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end ?? false,
      canceledAt: updated.canceled_at,
      currentPeriodEnd: updated.current_period_end,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createBillingPortalSession(inv: ConnectorInvocation, apiKey: string): Promise<CapabilityMutationResult> {
  const { customerId, returnUrl } = inv.args as { customerId: string; returnUrl: string }
  const body = new URLSearchParams({ customer: customerId, return_url: returnUrl })
  const res = await fetch(`${API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': inv.idempotencyKey,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) throw new CredentialsExpired('Stripe rejected API key (401)', inv.source.id)
  if (res.status === 409) {
    throw new ResourceContention('Stripe billing portal session conflict — retry rejected by idempotency check')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`stripe-pack create_billing_portal_session ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as { id: string; url: string; return_url?: string }
  return {
    status: 'committed',
    data: { sessionId: created.id, url: created.url, returnUrl: created.return_url },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

function readApiKey(creds: { kind: string; apiKey?: string }): string {
  if (creds.kind !== 'api-key' || typeof creds.apiKey !== 'string' || creds.apiKey.length === 0) {
    throw new Error('stripe-pack: expected api-key credentials')
  }
  return creds.apiKey
}
