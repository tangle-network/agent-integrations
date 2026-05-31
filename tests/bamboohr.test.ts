import { describe, expect, it } from 'vitest'
import { bamboohrConnector } from '../src/connectors/adapters/bamboohr.js'

describe('bamboohr adapter manifest', () => {
  it('exposes the bamboohr kind under the other category with authoritative consistency', () => {
    expect(bamboohrConnector.manifest.kind).toBe('bamboohr')
    expect(bamboohrConnector.manifest.category).toBe('other')
    expect(bamboohrConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(bamboohrConnector.manifest.displayName).toBe('BambooHR')
  })

  it('uses api-key auth with a Basic-Auth UI hint', () => {
    const auth = bamboohrConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('bamboohr api key')
    expect(auth.hint.toLowerCase()).toContain('base64')
  })

  it('covers employees, time-off, reports, files, and meta', () => {
    const names = bamboohrConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'employees.directory',
        'employees.get',
        'employees.create',
        'employees.update',
        'employees.list_custom_table',
        'timeoff.types.list',
        'timeoff.requests.list',
        'timeoff.requests.create',
        'timeoff.requests.change_status',
        'reports.list',
        'reports.run',
        'reports.custom',
        'files.list',
        'files.get_metadata',
        'meta.fields',
        'meta.lists',
      ].sort(),
    )
  })

  it('splits capabilities correctly between reads and mutations', () => {
    const reads = bamboohrConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = bamboohrConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'employees.directory',
        'employees.get',
        'employees.list_custom_table',
        'timeoff.types.list',
        'timeoff.requests.list',
        'reports.list',
        'reports.run',
        'files.list',
        'files.get_metadata',
        'meta.fields',
        'meta.lists',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'employees.create',
        'employees.update',
        'timeoff.requests.create',
        'timeoff.requests.change_status',
        'reports.custom',
      ].sort(),
    )
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of bamboohrConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
