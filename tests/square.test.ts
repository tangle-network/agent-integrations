import { describe, expect, it } from 'vitest'
import { squareConnector } from '../src/connectors/adapters/square.js'

describe('square adapter manifest', () => {
  it('classifies itself as crm category and exposes the square kind', () => {
    expect(squareConnector.manifest.kind).toBe('square')
    expect(squareConnector.manifest.category).toBe('crm')
    expect(squareConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with Square OAuth endpoints', () => {
    const auth = squareConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/connect\.squareup\.com/)
    expect(auth.tokenUrl).toMatch(/connect\.squareup\.com/)
  })

  it('covers customers, payments, and invoices capability surface', () => {
    const names = squareConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('customers.list')
    expect(names).toContain('customers.get')
    expect(names).toContain('customers.create')
    expect(names).toContain('customers.update')
    expect(names).toContain('payments.list')
    expect(names).toContain('payments.get')
    expect(names).toContain('invoices.list')
    expect(names).toContain('invoices.get')
    expect(names).toContain('invoices.create')
    expect(names).toContain('invoices.update')
  })

  it('marks mutations for create and update operations', () => {
    const mutations = squareConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('customers.create')
    expect(mutations).toContain('customers.update')
    expect(mutations).toContain('invoices.create')
    expect(mutations).toContain('invoices.update')
  })

  it('marks read-only operations as read', () => {
    const reads = squareConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('customers.list')
    expect(reads).toContain('customers.get')
    expect(reads).toContain('payments.list')
    expect(reads).toContain('payments.get')
    expect(reads).toContain('invoices.list')
    expect(reads).toContain('invoices.get')
  })
})
