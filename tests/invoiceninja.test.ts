import { describe, expect, it } from 'vitest'
import { invoiceninjaConnector } from '../src/connectors/adapters/invoiceninja.js'

describe('invoiceninja adapter manifest', () => {
  it('classifies itself as the crm category and exposes the invoiceninja kind', () => {
    expect(invoiceninjaConnector.manifest.kind).toBe('invoiceninja')
    expect(invoiceninjaConnector.manifest.category).toBe('crm')
    expect(invoiceninjaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = invoiceninjaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (clients, invoices, recurring, tasks, reports)', () => {
    const names = invoiceninjaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'clients.create',
        'clients.get',
        'invoices.create',
        'invoices.list',
        'recurring_invoices.create',
        'recurring_invoices.action',
        'tasks.create',
        'tasks.exists',
        'reports.get',
      ].sort(),
    )
    const reads = invoiceninjaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = invoiceninjaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['clients.get', 'invoices.list', 'reports.get', 'tasks.exists'].sort())
    expect(mutations).toEqual(
      [
        'clients.create',
        'invoices.create',
        'recurring_invoices.action',
        'recurring_invoices.create',
        'tasks.create',
      ].sort(),
    )
  })
})
