import { describe, expect, it } from 'vitest'
import { gustoConnector } from '../src/connectors/adapters/gusto.js'

describe('gusto adapter manifest', () => {
  it('exposes the gusto kind, "other" category, and authoritative consistency', () => {
    expect(gustoConnector.manifest.kind).toBe('gusto')
    expect(gustoConnector.manifest.category).toBe('other')
    expect(gustoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth pointed at api.gusto.com with documented client env vars', () => {
    const auth = gustoConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://api.gusto.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.gusto.com/oauth/token')
    expect(auth.clientIdEnv).toBe('GUSTO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GUSTO_OAUTH_CLIENT_SECRET')
    // sanity: capability-level scope vocabulary is surfaced for the policy layer
    expect(auth.scopes).toEqual(expect.arrayContaining([
      'companies:read',
      'employees:read',
      'employees:write',
      'payrolls:read',
      'payrolls:write',
    ]))
  })

  it('covers the company/employee/job/compensation/contractor/payroll surface', () => {
    const names = gustoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'me.get',
        'companies.get',
        'employees.list',
        'employees.get',
        'employees.create',
        'employees.update',
        'employees.terminate',
        'jobs.list',
        'jobs.create',
        'jobs.update',
        'compensations.list',
        'compensations.create',
        'compensations.update',
        'contractors.list',
        'contractors.get',
        'contractors.create',
        'payrolls.list',
        'payrolls.get',
        'payrolls.create_off_cycle',
        'payrolls.submit',
        'payrolls.cancel',
      ].sort(),
    )
  })

  it('marks state-mutating writes with version tokens as optimistic-read-verify and create/lifecycle mutations as native-idempotency', () => {
    const byName = new Map(gustoConnector.manifest.capabilities.map((c) => [c.name, c]))
    const employeesUpdate = byName.get('employees.update')
    const jobsUpdate = byName.get('jobs.update')
    const compensationsUpdate = byName.get('compensations.update')
    const employeesCreate = byName.get('employees.create')
    const payrollSubmit = byName.get('payrolls.submit')
    const payrollCancel = byName.get('payrolls.cancel')
    if (
      !employeesUpdate || employeesUpdate.class !== 'mutation' ||
      !jobsUpdate || jobsUpdate.class !== 'mutation' ||
      !compensationsUpdate || compensationsUpdate.class !== 'mutation' ||
      !employeesCreate || employeesCreate.class !== 'mutation' ||
      !payrollSubmit || payrollSubmit.class !== 'mutation' ||
      !payrollCancel || payrollCancel.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(employeesUpdate.cas).toBe('optimistic-read-verify')
    expect(jobsUpdate.cas).toBe('optimistic-read-verify')
    expect(compensationsUpdate.cas).toBe('optimistic-read-verify')
    expect(employeesCreate.cas).toBe('native-idempotency')
    expect(payrollSubmit.cas).toBe('native-idempotency')
    expect(payrollCancel.cas).toBe('native-idempotency')
  })
})
