import { describe, expect, it } from 'vitest'
import { instantlyAiConnector } from '../src/connectors/adapters/instantly-ai.js'

describe('instantly-ai adapter manifest', () => {
  it('classifies itself as the crm category and exposes the instantly-ai kind', () => {
    expect(instantlyAiConnector.manifest.kind).toBe('instantly-ai')
    expect(instantlyAiConnector.manifest.category).toBe('crm')
    expect(instantlyAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = instantlyAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (campaigns, lead-lists, leads)', () => {
    const names = instantlyAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'campaigns.create',
        'lead-lists.create',
        'leads.add-to-campaign',
        'campaigns.search',
        'leads.search',
      ].sort(),
    )
    const reads = instantlyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = instantlyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['campaigns.search', 'leads.search'].sort())
    expect(mutations).toEqual(
      ['campaigns.create', 'lead-lists.create', 'leads.add-to-campaign'].sort(),
    )
  })
})
