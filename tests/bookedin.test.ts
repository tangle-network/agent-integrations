import { describe, expect, it } from 'vitest'
import { bookedinConnector } from '../src/connectors/adapters/bookedin.js'

describe('bookedin adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bookedin kind', () => {
    expect(bookedinConnector.manifest.kind).toBe('bookedin')
    expect(bookedinConnector.manifest.category).toBe('crm')
    expect(bookedinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = bookedinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (leads CRUD + stats)', () => {
    const names = bookedinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'leads.list',
        'leads.get',
        'leads.stats',
        'leads.create',
        'leads.update',
        'leads.delete',
      ].sort(),
    )
    const reads = bookedinConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = bookedinConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['leads.get', 'leads.list', 'leads.stats'].sort())
    expect(mutations).toEqual(['leads.create', 'leads.delete', 'leads.update'].sort())
  })
})
