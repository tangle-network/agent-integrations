import { describe, expect, it } from 'vitest'
import { actualbudgetConnector } from '../src/connectors/adapters/actualbudget.js'

describe('actualbudget adapter manifest', () => {
  it('classifies itself as the other category and exposes the actualbudget kind', () => {
    expect(actualbudgetConnector.manifest.kind).toBe('actualbudget')
    expect(actualbudgetConnector.manifest.category).toBe('other')
    expect(actualbudgetConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = actualbudgetConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (budget, categories, accounts, transactions)', () => {
    const names = actualbudgetConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'budget.get',
        'categories.list',
        'accounts.list',
        'transactions.import',
        'transactions.batch-import',
      ].sort(),
    )
    const reads = actualbudgetConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = actualbudgetConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['budget.get', 'categories.list', 'accounts.list'].sort())
    expect(mutations).toEqual(['transactions.import', 'transactions.batch-import'].sort())
  })
})
