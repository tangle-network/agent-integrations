import { describe, expect, it } from 'vitest'
import { segmentConnector } from '../src/connectors/adapters/segment.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

describe('segment adapter manifest', () => {
  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(segmentConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('exposes the segment kind, database category, and authoritative consistency', () => {
    expect(segmentConnector.manifest.kind).toBe('segment')
    expect(segmentConnector.manifest.displayName).toBe('Segment')
    expect(segmentConnector.manifest.category).toBe('database')
    expect(segmentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (Segment Public API is a workspace-issued personal access token)', () => {
    const auth = segmentConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/personal access token/i)
    expect(auth.hint).toMatch(/segment/i)
  })

  it('covers the Public API surface: sources, destinations, tracking-plans, audiences', () => {
    const names = segmentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sources.search',
        'sources.get',
        'sources.create',
        'sources.update',
        'sources.delete',
        'destinations.search',
        'destinations.get',
        'destinations.create',
        'destinations.update',
        'destinations.delete',
        'tracking-plans.search',
        'tracking-plans.get',
        'tracking-plans.create',
        'tracking-plans.update',
        'tracking-plans.delete',
        'audiences.search',
        'audiences.get',
        'audiences.create',
      ].sort(),
    )
    const reads = segmentConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = segmentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'audiences.get',
        'audiences.search',
        'destinations.get',
        'destinations.search',
        'sources.get',
        'sources.search',
        'tracking-plans.get',
        'tracking-plans.search',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'audiences.create',
        'destinations.create',
        'destinations.delete',
        'destinations.update',
        'sources.create',
        'sources.delete',
        'sources.update',
        'tracking-plans.create',
        'tracking-plans.delete',
        'tracking-plans.update',
      ].sort(),
    )
  })

  it('marks every mutation native-idempotency (Segment Public API is fully idempotent on configuration writes)', () => {
    const mutations = segmentConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const mutation of mutations) {
      if (mutation.class !== 'mutation') throw new Error('unreachable')
      expect(mutation.cas).toBe('native-idempotency')
    }
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof segmentConnector.executeRead).toBe('function')
    expect(typeof segmentConnector.executeMutation).toBe('function')
  })
})
