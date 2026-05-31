import { describe, expect, it } from 'vitest'
import { fountainConnector } from '../src/connectors/adapters/fountain.js'

describe('fountain adapter manifest', () => {
  it('exposes the fountain kind under the calendar category with authoritative consistency', () => {
    expect(fountainConnector.manifest.kind).toBe('fountain')
    expect(fountainConnector.manifest.category).toBe('calendar')
    expect(fountainConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(fountainConnector.manifest.displayName).toBe('Fountain')
  })

  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = fountainConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('fountain api key')
  })

  it('covers applicants, openings, stages, and interview sessions from the catalog actions', () => {
    const names = fountainConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'applicants.list',
        'applicants.get',
        'applicants.create',
        'applicants.update',
        'applicants.delete',
        'applicants.interviewSessions',
        'openings.list',
        'openings.get',
        'stages.list',
        'stages.get',
      ].sort(),
    )
  })

  it('splits capabilities correctly between reads and mutations', () => {
    const reads = fountainConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = fountainConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'applicants.list',
        'applicants.get',
        'applicants.interviewSessions',
        'openings.list',
        'openings.get',
        'stages.list',
        'stages.get',
      ].sort(),
    )
    expect(mutations).toEqual(['applicants.create', 'applicants.update', 'applicants.delete'].sort())
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of fountainConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
