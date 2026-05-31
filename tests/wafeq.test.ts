import { describe, expect, it } from 'vitest'
import { wafeqConnector } from '../src/connectors/adapters/wafeq.js'

describe('wafeq adapter manifest', () => {
  it('classifies itself as the crm category and exposes the wafeq kind', () => {
    expect(wafeqConnector.manifest.kind).toBe('wafeq')
    expect(wafeqConnector.manifest.category).toBe('crm')
    expect(wafeqConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = wafeqConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, invoices, bills, quotes, items, accounts, payments)', () => {
    const names = wafeqConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.find',
        'invoices.create',
        'invoices.simplified',
        'invoices.report.tax',
        'invoices.download.pdf',
        'bills.create',
        'credits.create',
        'quotes.create',
        'quotes.convert',
        'payments.record',
        'items.create',
        'items.list',
        'accounts.list',
      ].sort(),
    )
    const reads = wafeqConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = wafeqConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find', 'invoices.download.pdf', 'items.list', 'accounts.list'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'invoices.create',
        'invoices.simplified',
        'invoices.report.tax',
        'bills.create',
        'credits.create',
        'quotes.create',
        'quotes.convert',
        'payments.record',
        'items.create',
      ].sort(),
    )
  })
})
