import { describe, expect, it } from 'vitest'
import { pinchPaymentsConnector } from '../src/connectors/adapters/pinch-payments.js'

describe('pinch-payments adapter manifest', () => {
  it('classifies itself as the crm category and exposes the pinch-payments kind', () => {
    expect(pinchPaymentsConnector.manifest.kind).toBe('pinch-payments')
    expect(pinchPaymentsConnector.manifest.category).toBe('crm')
    expect(pinchPaymentsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = pinchPaymentsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (payers, sources, payments, subscriptions, events)', () => {
    const names = pinchPaymentsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'payers.create-or-update',
        'payers.find',
        'sources.add-to-payer',
        'payments.create-realtime',
        'payments.create-or-update-scheduled',
        'subscriptions.create-or-update',
        'subscriptions.find',
        'events.find',
      ].sort(),
    )
    const reads = pinchPaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = pinchPaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['events.find', 'payers.find', 'subscriptions.find'].sort())
    expect(mutations).toEqual(
      [
        'payers.create-or-update',
        'sources.add-to-payer',
        'payments.create-realtime',
        'payments.create-or-update-scheduled',
        'subscriptions.create-or-update',
      ].sort(),
    )
  })
})
