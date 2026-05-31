import { describe, expect, it } from 'vitest'
import { campaignMonitorConnector } from '../src/connectors/adapters/campaign-monitor.js'

describe('campaign-monitor adapter manifest', () => {
  it('classifies itself as the crm category and exposes the campaign-monitor kind', () => {
    expect(campaignMonitorConnector.manifest.kind).toBe('campaign-monitor')
    expect(campaignMonitorConnector.manifest.category).toBe('crm')
    expect(campaignMonitorConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = campaignMonitorConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (add/update/unsubscribe/find subscribers)', () => {
    const names = campaignMonitorConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['subscriber.add', 'subscriber.update', 'subscriber.unsubscribe', 'subscriber.find'].sort(),
    )
    const reads = campaignMonitorConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = campaignMonitorConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['subscriber.find'].sort())
    expect(mutations).toEqual(
      ['subscriber.add', 'subscriber.update', 'subscriber.unsubscribe'].sort(),
    )
  })
})
