import { describe, expect, it } from 'vitest'
import { googleBigqueryConnector } from '../src/connectors/adapters/google-bigquery.js'

describe('google-bigquery adapter manifest', () => {
  it('exposes the google-bigquery kind under the database category with authoritative consistency', () => {
    expect(googleBigqueryConnector.manifest.kind).toBe('google-bigquery')
    expect(googleBigqueryConnector.manifest.category).toBe('database')
    expect(googleBigqueryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(googleBigqueryConnector.manifest.displayName).toBe('Google BigQuery')
  })

  it('uses oauth2 auth matching the activepieces catalog entry', () => {
    const auth = googleBigqueryConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/bigquery')
  })

  it('covers queries, streaming inserts, DML mutations, load jobs, and discovery', () => {
    const names = googleBigqueryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'query.run',
        'jobs.getQueryResults',
        'jobs.get',
        'rows.insert.one',
        'rows.insert.many',
        'rows.findOne',
        'rows.findOrCreate',
        'rows.update',
        'rows.delete',
        'data.import',
        'datasets.list',
        'tables.list',
        'tables.get',
      ].sort(),
    )
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of googleBigqueryConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
