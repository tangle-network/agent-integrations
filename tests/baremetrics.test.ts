import { describe, expect, it } from 'vitest'
import { baremetricsConnector } from '../src/connectors/adapters/baremetrics.js'

describe('baremetrics adapter manifest', () => {
  it('classifies itself as the crm category and exposes the baremetrics kind', () => {
    expect(baremetricsConnector.manifest.kind).toBe('baremetrics')
    expect(baremetricsConnector.manifest.category).toBe('crm')
    expect(baremetricsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = baremetricsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: create customer/plan/subscription and update customer', () => {
    const names = baremetricsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['create.customer', 'create.plan', 'create.subscription', 'update.customer'].sort(),
    )
    const mutations = baremetricsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['create.customer', 'create.plan', 'create.subscription', 'update.customer'].sort(),
    )
  })
})
