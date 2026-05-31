import { describe, expect, it } from 'vitest'
import { lemlistConnector } from '../src/connectors/adapters/lemlist.js'

describe('lemlist adapter manifest', () => {
  it('classifies itself as the crm category and exposes the lemlist kind', () => {
    expect(lemlistConnector.manifest.kind).toBe('lemlist')
    expect(lemlistConnector.manifest.category).toBe('crm')
    expect(lemlistConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = lemlistConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the lemlist lead-management action surface (add, update, remove, mark, pause, resume, unsubscribe, search)', () => {
    const names = lemlistConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'leads.search',
        'leads.add.to.campaign',
        'leads.update.in.campaign',
        'leads.remove.from.campaign',
        'leads.mark.interested.in.campaign',
        'leads.mark.not.interested.in.campaign',
        'leads.mark.interested.all.campaigns',
        'leads.mark.not.interested.all.campaigns',
        'leads.pause.in.campaigns',
        'leads.resume.in.campaigns',
        'leads.unsubscribe',
        'unsubscribes.remove',
      ].sort(),
    )
    const reads = lemlistConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['leads.search'])
  })
})
