import { describe, expect, it } from 'vitest'
import { zuoraConnector } from '../src/connectors/adapters/zuora'

describe('zuoraConnector', () => {
  const connector = zuoraConnector

  it('exports a connector with correct manifest structure', () => {
    expect(connector).toBeDefined()
    expect(connector.manifest.kind).toBe('zuora')
  })

  it('manifest has correct kind and category', () => {
    expect(connector.manifest.kind).toBe('zuora')
    expect(connector.manifest.category).toBe('crm')
  })

  it('manifest auth kind is oauth2', () => {
    expect(connector.manifest.auth.kind).toBe('oauth2')
  })

  it('has the expected capabilities', () => {
    expect(connector.manifest.capabilities).toHaveLength(4)
    const names = connector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('accounts.find')
    expect(names).toContain('products.find')
    expect(names).toContain('products.rate_plans.find')
    expect(names).toContain('invoices.create')
  })

  it('has read capabilities for account and product lookups', () => {
    const readCaps = connector.manifest.capabilities.filter((c) => c.class === 'read')
    expect(readCaps.length).toBeGreaterThan(0)
    expect(readCaps.some((c) => c.name === 'accounts.find')).toBe(true)
    expect(readCaps.some((c) => c.name === 'products.find')).toBe(true)
  })

  it('has mutation capability for invoice creation', () => {
    const invoiceCreate = connector.manifest.capabilities.find((c) => c.name === 'invoices.create')
    expect(invoiceCreate).toBeDefined()
    expect(invoiceCreate?.class).toBe('mutation')
  })
})
