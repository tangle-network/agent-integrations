import { describe, expect, it } from 'vitest'
import { predictLeadsConnector } from '../src/connectors/adapters/predict-leads.js'

describe('predict-leads adapter manifest', () => {
  it('classifies itself as the database category and exposes the predict-leads kind', () => {
    expect(predictLeadsConnector.manifest.kind).toBe('predict-leads')
    expect(predictLeadsConnector.manifest.category).toBe('database')
    expect(predictLeadsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = predictLeadsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/PredictLeads/i)
  })

  it('covers companies, job openings, technologies, news events, and connections capability surface', () => {
    const names = predictLeadsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'companies.find',
        'companies.findByDomain',
        'companies.findByTechnologyId',
        'connections.find',
        'connections.findByDomain',
        'jobOpenings.find',
        'jobOpenings.getById',
        'jobOpenings.getCompanyActions',
        'newsEvents.findById',
        'newsEvents.findByDomain',
        'technologies.findByCompany',
      ].sort(),
    )
    const reads = predictLeadsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(names)
  })
})
