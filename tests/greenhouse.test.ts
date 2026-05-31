import { describe, expect, it } from 'vitest'
import { greenhouseConnector } from '../src/connectors/adapters/greenhouse.js'

describe('greenhouse adapter manifest', () => {
  it('exposes the greenhouse kind, "other" category, and authoritative consistency', () => {
    expect(greenhouseConnector.manifest.kind).toBe('greenhouse')
    expect(greenhouseConnector.manifest.category).toBe('other')
    expect(greenhouseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (Harvest API uses an account-scoped key over HTTP Basic; OAuth is gated to partner ingest)', () => {
    const auth = greenhouseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
    expect(auth.hint).toMatch(/Basic/i)
  })

  it('covers candidates, applications, jobs, users, offers, scorecards, and prospects', () => {
    const names = greenhouseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'candidates.search',
        'candidates.get',
        'candidates.create',
        'candidates.update',
        'candidates.anonymize',
        'applications.list',
        'applications.get',
        'applications.advance',
        'applications.reject',
        'applications.hire',
        'jobs.list',
        'jobs.get',
        'jobs.openings.list',
        'users.list',
        'users.get',
        'offers.list',
        'offers.get',
        'scorecards.list',
        'scorecards.get',
        'prospects.create',
      ].sort(),
    )
  })

  it('flags every state-changing call as a mutation and the rest as reads', () => {
    const reads = greenhouseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = greenhouseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'applications.get',
        'applications.list',
        'candidates.get',
        'candidates.search',
        'jobs.get',
        'jobs.list',
        'jobs.openings.list',
        'offers.get',
        'offers.list',
        'scorecards.get',
        'scorecards.list',
        'users.get',
        'users.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'applications.advance',
        'applications.hire',
        'applications.reject',
        'candidates.anonymize',
        'candidates.create',
        'candidates.update',
        'prospects.create',
      ].sort(),
    )
  })

  it('marks non-idempotent creates as cas="none" and the anonymize endpoint as native-idempotency', () => {
    const byName = new Map(greenhouseConnector.manifest.capabilities.map((c) => [c.name, c]))
    const candidatesCreate = byName.get('candidates.create')
    const prospectsCreate = byName.get('prospects.create')
    const applicationsAdvance = byName.get('applications.advance')
    const candidatesAnonymize = byName.get('candidates.anonymize')
    if (
      !candidatesCreate ||
      candidatesCreate.class !== 'mutation' ||
      !prospectsCreate ||
      prospectsCreate.class !== 'mutation' ||
      !applicationsAdvance ||
      applicationsAdvance.class !== 'mutation' ||
      !candidatesAnonymize ||
      candidatesAnonymize.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(candidatesCreate.cas).toBe('none')
    expect(prospectsCreate.cas).toBe('none')
    expect(applicationsAdvance.cas).toBe('none')
    expect(candidatesAnonymize.cas).toBe('native-idempotency')
  })
})
