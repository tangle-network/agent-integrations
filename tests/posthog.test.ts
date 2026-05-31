import { describe, expect, it } from 'vitest'
import { posthogConnector } from '../src/connectors/adapters/posthog.js'

describe('posthog adapter manifest', () => {
  it('classifies itself as the database category and exposes the posthog kind', () => {
    expect(posthogConnector.manifest.kind).toBe('posthog')
    expect(posthogConnector.manifest.category).toBe('database')
    expect(posthogConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = posthogConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (events, projects, cohorts, feature-flags)', () => {
    const names = posthogConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'events.create',
        'projects.create',
        'projects.list',
        'projects.get',
        'cohorts.list',
        'feature-flags.list',
        'feature-flags.create',
      ].sort(),
    )
    const reads = posthogConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = posthogConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['cohorts.list', 'feature-flags.list', 'projects.get', 'projects.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'events.create',
        'feature-flags.create',
        'projects.create',
      ].sort(),
    )
  })
})
