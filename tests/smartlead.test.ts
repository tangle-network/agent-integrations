import { describe, expect, it } from 'vitest'
import { smartleadConnector } from '../src/connectors/adapters/smartlead.js'

describe('smartlead adapter manifest', () => {
  it('classifies itself as the crm category and exposes the smartlead kind', () => {
    expect(smartleadConnector.manifest.kind).toBe('smartlead')
    expect(smartleadConnector.manifest.category).toBe('crm')
    expect(smartleadConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a SmartLead-specific hint', () => {
    const auth = smartleadConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SmartLead/i)
  })

  it('covers campaigns and leads capability surface', () => {
    const names = smartleadConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('campaigns.create')
    expect(names).toContain('campaigns.statistics')
    expect(names).toContain('campaigns.update')
    expect(names).toContain('leads.add')
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = smartleadConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('campaigns.create')
    expect(mutations).toContain('campaigns.update')
    expect(mutations).toContain('leads.add')
  })

  it('marks read-only operations as read', () => {
    const reads = smartleadConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('campaigns.statistics')
  })
})
