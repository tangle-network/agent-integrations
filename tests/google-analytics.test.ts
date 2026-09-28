import { describe, expect, it } from 'vitest'
import { googleAnalyticsConnector } from '../src/connectors/adapters/google-analytics.js'

describe('google-analytics adapter manifest', () => {
  it('runReport requires propertyId, metrics, and dateRanges — the GA4 Data API rejects any of these as missing', () => {
    const runReport = googleAnalyticsConnector.manifest.capabilities.find((c) => c.name === 'properties.runReport')
    if (!runReport) throw new Error('runReport capability missing')
    const params = runReport.parameters as { required?: string[] }
    expect(params.required).toEqual(expect.arrayContaining(['propertyId', 'metrics', 'dateRanges']))
  })
})
