import { describe, expect, it } from 'vitest'
import { pagerdutyConnector } from '../src/connectors/adapters/pagerduty.js'

describe('pagerduty adapter manifest', () => {
  it('classifies itself with the pagerduty kind and the other category', () => {
    expect(pagerdutyConnector.manifest.kind).toBe('pagerduty')
    expect(pagerdutyConnector.manifest.category).toBe('other')
    expect(pagerdutyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented PagerDuty identity endpoints and env-var names', () => {
    const auth = pagerdutyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://identity.pagerduty.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://identity.pagerduty.com/oauth/token')
    expect(auth.clientIdEnv).toBe('PAGERDUTY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('PAGERDUTY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('incidents.read')
    expect(auth.scopes).toContain('incidents.write')
    expect(auth.scopes).toContain('services.write')
    expect(auth.scopes).toContain('escalation_policies.write')
    expect(auth.scopes).toContain('schedules.read')
    expect(auth.scopes).toContain('oncalls.read')
  })

  it('exposes the incident + service + escalation-policy + schedule + oncall surface', () => {
    const names = pagerdutyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'incidents.list',
        'incidents.get',
        'incidents.create',
        'incidents.update',
        'incidents.notes.list',
        'incidents.notes.create',
        'incidents.snooze',
        'services.list',
        'services.get',
        'services.create',
        'services.update',
        'services.delete',
        'escalation_policies.list',
        'escalation_policies.get',
        'escalation_policies.create',
        'escalation_policies.update',
        'schedules.list',
        'schedules.get',
        'oncalls.list',
        'teams.list',
        'users.list',
        'users.get',
        'users.me',
      ].sort(),
    )
    const reads = pagerdutyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = pagerdutyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(reads).toContain('incidents.list')
    expect(reads).toContain('oncalls.list')
    expect(reads).toContain('users.me')
    expect(mutations).toContain('incidents.create')
    expect(mutations).toContain('incidents.snooze')
    expect(mutations).toContain('services.delete')
    expect(mutations).toContain('escalation_policies.create')
  })
})
