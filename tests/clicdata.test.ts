import { describe, expect, it } from 'vitest'
import { clicdataConnector } from '../src/connectors/adapters/clicdata.js'

describe('clicdata adapter manifest', () => {
  it('classifies itself as the database category and exposes the clicdata kind', () => {
    expect(clicdataConnector.manifest.kind).toBe('clicdata')
    expect(clicdataConnector.manifest.category).toBe('database')
    expect(clicdataConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = clicdataConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes read + mutation capabilities over datasets and dashboards', () => {
    const names = clicdataConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.get',
        'dashboards.get',
        'dashboards.list',
        'datasets.clear',
        'datasets.get',
        'datasets.list',
        'datasets.refresh',
        'datasets.rows',
        'datasets.rows.append',
        'datasets.rows.replace',
      ].sort(),
    )
    const reads = clicdataConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clicdataConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'account.get',
        'dashboards.get',
        'dashboards.list',
        'datasets.get',
        'datasets.list',
        'datasets.rows',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'datasets.clear',
        'datasets.refresh',
        'datasets.rows.append',
        'datasets.rows.replace',
      ].sort(),
    )
  })
})
