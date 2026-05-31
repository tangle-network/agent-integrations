import { describe, expect, it } from 'vitest'
import { microsoftDynamics365BusinessCentralConnector } from '../src/connectors/adapters/microsoft-dynamics-365-business-central.js'

describe('microsoft-dynamics-365-business-central adapter manifest', () => {
  it('exposes the catalog kind, "crm" category, and authoritative consistency', () => {
    expect(microsoftDynamics365BusinessCentralConnector.manifest.kind).toBe(
      'microsoft-dynamics-365-business-central',
    )
    expect(microsoftDynamics365BusinessCentralConnector.manifest.category).toBe('crm')
    expect(microsoftDynamics365BusinessCentralConnector.manifest.defaultConsistencyModel).toBe(
      'authoritative',
    )
  })

  it('uses oauth2 against the Microsoft v2 endpoints (matches catalog auth=oauth2)', () => {
    const auth = microsoftDynamics365BusinessCentralConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    )
    expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    // offline_access is required to receive a refresh_token on the
    // v2.0 endpoints; the Financials.ReadWrite.All scope is what BC's
    // public OData API actually checks.
    expect(auth.scopes).toContain('offline_access')
    expect(auth.scopes).toContain(
      'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All',
    )
    expect(auth.clientIdEnv).toBe('BUSINESS_CENTRAL_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('BUSINESS_CENTRAL_OAUTH_CLIENT_SECRET')
  })

  it('covers the five Activepieces record verbs (create / delete / get / search / update)', () => {
    const names = microsoftDynamics365BusinessCentralConnector.manifest.capabilities
      .map((c) => c.name)
      .sort()
    expect(names).toEqual(
      [
        'records.create',
        'records.delete',
        'records.get',
        'records.search',
        'records.update',
      ].sort(),
    )
    const reads = microsoftDynamics365BusinessCentralConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoftDynamics365BusinessCentralConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.get', 'records.search'].sort())
    expect(mutations).toEqual(
      ['records.create', 'records.delete', 'records.update'].sort(),
    )
  })

  it('marks update + delete as etag-if-match and create as native-idempotency', () => {
    const byName = new Map(
      microsoftDynamics365BusinessCentralConnector.manifest.capabilities.map((c) => [c.name, c]),
    )
    const create = byName.get('records.create')
    const update = byName.get('records.update')
    const del = byName.get('records.delete')
    if (
      !create ||
      create.class !== 'mutation' ||
      !update ||
      update.class !== 'mutation' ||
      !del ||
      del.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(create.cas).toBe('native-idempotency')
    expect(update.cas).toBe('etag-if-match')
    expect(del.cas).toBe('etag-if-match')
  })
})
