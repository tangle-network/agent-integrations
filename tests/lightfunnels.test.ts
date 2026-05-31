import { describe, expect, it } from 'vitest'
import { lightfunnelsConnector } from '../src/connectors/adapters/lightfunnels.js'

describe('lightfunnels adapter manifest', () => {
  it('classifies itself under commerce and exposes the lightfunnels kind', () => {
    expect(lightfunnelsConnector.manifest.kind).toBe('lightfunnels')
    // activepieces lists the piece under the "crm" category but the actual
    // surface (products / orders / customers / funnels) is e-commerce; we
    // route it to the closest enum value our manifest accepts.
    expect(lightfunnelsConnector.manifest.category).toBe('commerce')
    expect(lightfunnelsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = lightfunnelsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.authorizationUrl).toMatch(/lightfunnels\.com/)
      expect(auth.tokenUrl).toMatch(/lightfunnels\.com/)
      expect(auth.clientIdEnv).toBe('LIGHTFUNNELS_OAUTH_CLIENT_ID')
      expect(auth.clientSecretEnv).toBe('LIGHTFUNNELS_OAUTH_CLIENT_SECRET')
    }
  })

  it('covers the full activepieces action set (products, orders, customers, funnel)', () => {
    const names = lightfunnelsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'list.products',
        'get.product',
        'create.product',
        'get.order',
        'list.orders',
        'cancel.order',
        'create.customer',
        'get.customer',
        'list.customers',
        'get.funnel',
      ].sort(),
    )
    const reads = lightfunnelsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = lightfunnelsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'list.products',
        'get.product',
        'get.order',
        'list.orders',
        'get.customer',
        'list.customers',
        'get.funnel',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['create.product', 'cancel.order', 'create.customer'].sort(),
    )
  })
})
