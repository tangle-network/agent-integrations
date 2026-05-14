import { describe, expect, it, vi } from 'vitest'
import {
  buildStripeClient,
  EnvTenantConfigResolver,
  getStripeClient,
  makeStripeSecretResolver,
  memoizeResolver,
  PRODUCT_IDS,
  StaticTenantConfigResolver,
} from '../src/stripe/tenant-config'
import { ConfigError } from '../src/stripe/errors'

describe('PRODUCT_IDS', () => {
  it('lists the five product agents and is frozen', () => {
    expect(PRODUCT_IDS).toEqual(['legal', 'tax', 'gtm', 'creative', 'agent-builder'])
    expect(Object.isFrozen(PRODUCT_IDS)).toBe(true)
  })
})

describe('EnvTenantConfigResolver', () => {
  it('resolves from STRIPE_SK_<PRODUCT> + STRIPE_WHSEC_<PRODUCT>', () => {
    const r = new EnvTenantConfigResolver({
      STRIPE_SK_LEGAL: 'sk_test_1',
      STRIPE_WHSEC_LEGAL: 'whsec_1',
      STRIPE_SUCCESS_URL_LEGAL: 'https://l/s',
      STRIPE_CANCEL_URL_LEGAL: 'https://l/c',
    } as NodeJS.ProcessEnv)
    expect(r.resolve('legal')).toEqual({
      productId: 'legal',
      secretKey: 'sk_test_1',
      webhookSecret: 'whsec_1',
      successUrl: 'https://l/s',
      cancelUrl: 'https://l/c',
    })
  })

  it('maps hyphenated product ids to underscored env var keys', () => {
    const r = new EnvTenantConfigResolver({
      STRIPE_SK_AGENT_BUILDER: 'sk_x',
      STRIPE_WHSEC_AGENT_BUILDER: 'wh_x',
    } as NodeJS.ProcessEnv)
    expect(r.resolve('agent-builder')?.secretKey).toBe('sk_x')
  })

  it('returns null if either key is missing (no partial config)', () => {
    expect(new EnvTenantConfigResolver({ STRIPE_SK_TAX: 'sk' } as NodeJS.ProcessEnv).resolve('tax')).toBeNull()
    expect(new EnvTenantConfigResolver({ STRIPE_WHSEC_TAX: 'wh' } as NodeJS.ProcessEnv).resolve('tax')).toBeNull()
  })
})

describe('memoizeResolver', () => {
  it('caches resolves until TTL elapses', async () => {
    const inner = { resolve: vi.fn(async () => null) }
    const memo = memoizeResolver(inner, 60_000)
    await memo.resolve('legal')
    await memo.resolve('legal')
    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })

  it('caches null misses (so a missing tenant does not pound the vault)', async () => {
    const inner = { resolve: vi.fn(async () => null) }
    const memo = memoizeResolver(inner, 60_000)
    await memo.resolve('tax')
    await memo.resolve('tax')
    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })
})

describe('getStripeClient', () => {
  it('throws ConfigError when the resolver returns null (no silent fallback)', async () => {
    const resolver = new StaticTenantConfigResolver({})
    await expect(getStripeClient('legal', resolver)).rejects.toBeInstanceOf(ConfigError)
  })

  it('builds a client carrying the resolved config', async () => {
    const resolver = new StaticTenantConfigResolver({
      legal: { productId: 'legal', secretKey: 'sk_x', webhookSecret: 'wh_x' },
    })
    const client = await getStripeClient('legal', resolver)
    expect(client.productId).toBe('legal')
    expect(client.config.webhookSecret).toBe('wh_x')
  })
})

describe('buildStripeClient mutate', () => {
  it('forwards idempotency-key, sets form content-type on POST, and parses JSON response', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: string | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>
        capturedBody = init?.body?.toString()
        return new Response(JSON.stringify({ id: 'cs_1', url: 'https://stripe/cs_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    )
    try {
      const client = buildStripeClient({ productId: 'tax', secretKey: 'sk_x', webhookSecret: 'wh' })
      const out = await client.mutate('POST', '/checkout/sessions', { mode: 'subscription' }, 'idem_1')
      expect(out).toEqual({ id: 'cs_1', url: 'https://stripe/cs_1' })
      expect(capturedHeaders['authorization']).toBe('Bearer sk_x')
      expect(capturedHeaders['idempotency-key']).toBe('idem_1')
      expect(capturedHeaders['content-type']).toBe('application/x-www-form-urlencoded')
      expect(capturedBody).toBe('mode=subscription')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('throws when Stripe returns a non-2xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"oops"}', { status: 400 }),
    )
    try {
      const client = buildStripeClient({ productId: 'tax', secretKey: 'sk_x', webhookSecret: 'wh' })
      await expect(client.mutate('POST', '/x', {}, 'k')).rejects.toThrow(/stripe \/x 400/)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('makeStripeSecretResolver', () => {
  it('returns the webhook secret keyed off the x-tangle-product header', async () => {
    const resolver = new StaticTenantConfigResolver({
      legal: { productId: 'legal', secretKey: 'sk_x', webhookSecret: 'whsec_legal' },
    })
    const resolveSecret = makeStripeSecretResolver(resolver)
    const out = await resolveSecret('stripe', { 'x-tangle-product': 'legal' })
    expect(out).toBe('whsec_legal')
  })

  it('returns null for non-stripe provider ids (router will surface as no-secret)', async () => {
    const resolveSecret = makeStripeSecretResolver(new StaticTenantConfigResolver({}))
    expect(await resolveSecret('docuseal', { 'x-tangle-product': 'legal' })).toBeNull()
  })

  it('returns null when the product header is missing or unknown (defends against a forged route)', async () => {
    const resolveSecret = makeStripeSecretResolver(
      new StaticTenantConfigResolver({
        legal: { productId: 'legal', secretKey: 'x', webhookSecret: 'y' },
      }),
    )
    expect(await resolveSecret('stripe', {})).toBeNull()
    expect(await resolveSecret('stripe', { 'x-tangle-product': 'fictional-product' })).toBeNull()
  })

  it('accepts a string[] header value (some frameworks duplicate)', async () => {
    const resolveSecret = makeStripeSecretResolver(
      new StaticTenantConfigResolver({
        tax: { productId: 'tax', secretKey: 'x', webhookSecret: 'whsec_tax' },
      }),
    )
    expect(await resolveSecret('stripe', { 'x-tangle-product': ['tax', 'duplicate'] })).toBe('whsec_tax')
  })
})
