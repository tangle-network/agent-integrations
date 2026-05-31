import { describe, expect, it } from 'vitest'
import { pipedreamConnector } from '../src/connectors/adapters/pipedream.js'

describe('pipedream adapter manifest', () => {
  it('exposes the pipedream kind in the other category', () => {
    expect(pipedreamConnector.manifest.kind).toBe('pipedream')
    expect(pipedreamConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (bearer token from account settings)', () => {
    expect(pipedreamConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers workflows, sources, http-trigger, and subscription surfaces', () => {
    const names = pipedreamConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.list',
        'workflows.get',
        'sources.list',
        'sources.events',
        'http.trigger',
        'subscriptions.create',
      ].sort(),
    )
  })
})
