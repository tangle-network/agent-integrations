import { describe, expect, it } from 'vitest'
import { bexioConnector } from '../src/connectors/adapters/bexio.js'

describe('bexio adapter manifest', () => {
  it('classifies itself as the database category and exposes the bexio kind', () => {
    expect(bexioConnector.manifest.kind).toBe('bexio')
    expect(bexioConnector.manifest.category).toBe('database')
    expect(bexioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = bexioConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set (contacts, accounting, kb_*, projects, time tracking, refs)', () => {
    const names = bexioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.manual.entry',
        'create.company',
        'create.person',
        'update.person',
        'create.file',
        'create.sales.invoice',
        'export.invoice.pdf',
        'send.sales.invoice',
        'create.product',
        'update.product',
        'create.sales.order',
        'create.project',
        'create.sales.quote',
        'create.time.tracking',
        'update.company',
        'find.account',
        'find.company',
        'find.person',
        'find.product',
        'find.country',
        'search.invoice',
        'search.order',
        'search.quote',
      ].sort(),
    )

    const reads = bexioConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'find.account',
        'find.company',
        'find.person',
        'find.product',
        'find.country',
        'search.invoice',
        'search.order',
        'search.quote',
      ].sort(),
    )

    const mutations = bexioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'create.manual.entry',
        'create.company',
        'create.person',
        'update.person',
        'create.file',
        'create.sales.invoice',
        'export.invoice.pdf',
        'send.sales.invoice',
        'create.product',
        'update.product',
        'create.sales.order',
        'create.project',
        'create.sales.quote',
        'create.time.tracking',
        'update.company',
      ].sort(),
    )
  })
})
