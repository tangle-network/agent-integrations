import { describe, expect, it } from 'vitest'
import { tenzoConnector } from '../src/connectors/adapters/tenzo.js'

describe('tenzo adapter manifest', () => {
  it('classifies itself as the database category and exposes the tenzo kind', () => {
    expect(tenzoConnector.manifest.kind).toBe('tenzo')
    expect(tenzoConnector.manifest.category).toBe('database')
    expect(tenzoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = tenzoConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes data retrieval capabilities for forecasts, sales, payments, and insights', () => {
    const names = tenzoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['forecasts.list', 'insights.list', 'payments.summary', 'sales.summary'])
    const reads = tenzoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toHaveLength(4)
    expect(reads).toEqual(['forecasts.list', 'insights.list', 'payments.summary', 'sales.summary'])
  })
})
