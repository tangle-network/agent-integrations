import { describe, expect, it } from 'vitest'
import { stripeConnector } from '../src/connectors/adapters/stripe.js'

describe('stripe adapter manifest', () => {
  it('classifies itself as the crm category and exposes the stripe kind', () => {
    expect(stripeConnector.manifest.kind).toBe('stripe')
    expect(stripeConnector.manifest.category).toBe('crm')
    expect(stripeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('exposes api-key auth', () => {
    expect(stripeConnector.manifest.auth.kind).toBe('api-key')
  })

  it('declares capabilities', () => {
    expect(stripeConnector.manifest.capabilities.length).toBeGreaterThan(0)
    const capabilityNames = stripeConnector.manifest.capabilities.map((cap) => cap.name)
    expect(capabilityNames).toContain('customers.create')
    expect(capabilityNames).toContain('customers.retrieve')
    expect(capabilityNames).toContain('invoices.create')
    expect(capabilityNames).toContain('subscriptions.create')
    expect(capabilityNames).toContain('payment-intents.create')
  })
})
