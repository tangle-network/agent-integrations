import { describe, expect, it } from 'vitest'
import { makeConnector } from '../src/connectors/adapters/make.js'

describe('make adapter manifest', () => {
  it('exposes the make kind in the other category', () => {
    expect(makeConnector.manifest.kind).toBe('make')
    expect(makeConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (account-scoped token, regional zone host)', () => {
    expect(makeConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers scenarios, executions, and webhook-trigger surfaces', () => {
    const names = makeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'scenarios.list',
        'scenarios.get',
        'scenarios.run',
        'scenarios.activate',
        'scenarios.deactivate',
        'executions.list',
        'executions.get',
        'hooks.trigger',
      ].sort(),
    )
  })
})
