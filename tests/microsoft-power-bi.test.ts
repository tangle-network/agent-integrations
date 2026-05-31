import { describe, expect, it } from 'vitest'
import { microsoftPowerBiConnector } from '../src/connectors/adapters/microsoft-power-bi.js'

describe('microsoft-power-bi adapter manifest', () => {
  it('classifies itself as the database category and exposes the microsoft-power-bi kind', () => {
    expect(microsoftPowerBiConnector.manifest.kind).toBe('microsoft-power-bi')
    expect(microsoftPowerBiConnector.manifest.category).toBe('database')
    expect(microsoftPowerBiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = microsoftPowerBiConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (createDataset, pushRowsToDatasetTable)', () => {
    const names = microsoftPowerBiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.dataset', 'push.rows.to.dataset.table'].sort())
    const mutations = microsoftPowerBiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['create.dataset', 'push.rows.to.dataset.table'].sort())
  })
})
