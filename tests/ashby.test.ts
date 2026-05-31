import { describe, expect, it } from 'vitest'
import { ashbyConnector } from '../src/connectors/adapters/ashby.js'

describe('ashby adapter manifest', () => {
  it('exposes the ashby kind under the other category with authoritative consistency', () => {
    expect(ashbyConnector.manifest.kind).toBe('ashby')
    expect(ashbyConnector.manifest.category).toBe('other')
    expect(ashbyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(ashbyConnector.manifest.displayName).toBe('Ashby')
  })

  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = ashbyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('ashby api key')
    expect(auth.hint.toLowerCase()).toContain('basic')
  })

  it('covers candidates, jobs, applications, offers, feedback, and interview schedules', () => {
    const names = ashbyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'candidates.list',
        'candidates.info',
        'candidates.search',
        'candidates.create',
        'candidates.update',
        'candidates.addTag',
        'jobs.list',
        'jobs.info',
        'applications.list',
        'applications.info',
        'applications.create',
        'applications.changeStage',
        'offers.list',
        'offers.info',
        'feedback.list',
        'interviews.scheduleList',
      ].sort(),
    )
  })

  it('splits capabilities correctly between reads and mutations', () => {
    const reads = ashbyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = ashbyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'candidates.list',
        'candidates.info',
        'candidates.search',
        'jobs.list',
        'jobs.info',
        'applications.list',
        'applications.info',
        'offers.list',
        'offers.info',
        'feedback.list',
        'interviews.scheduleList',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'candidates.create',
        'candidates.update',
        'candidates.addTag',
        'applications.create',
        'applications.changeStage',
      ].sort(),
    )
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of ashbyConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
