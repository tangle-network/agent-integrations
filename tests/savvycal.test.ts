import { describe, expect, it } from 'vitest'
import { savvycalConnector } from '../src/connectors/adapters/savvycal.js'

describe('savvycal adapter manifest', () => {
  it('classifies itself as the doc category and exposes the savvycal kind', () => {
    expect(savvycalConnector.manifest.kind).toBe('savvycal')
    expect(savvycalConnector.manifest.category).toBe('doc')
    expect(savvycalConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with proper scopes', () => {
    const auth = savvycalConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toContain('read')
    expect(auth.scopes).toContain('write')
  })

  it('covers user, events, links, and workflow capability surface', () => {
    const names = savvycalConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('user.current')
    expect(names).toContain('events.list')
    expect(names).toContain('events.get')
    expect(names).toContain('events.create')
    expect(names).toContain('events.cancel')
    expect(names).toContain('events.findByEmail')
    expect(names).toContain('links.list')
    expect(names).toContain('links.get')
    expect(names).toContain('links.delete')
    expect(names).toContain('links.duplicate')
    expect(names).toContain('links.toggle')
    expect(names).toContain('links.slots')
    expect(names).toContain('workflows.list')
    expect(names).toContain('workflows.rules')
  })

  it('classifies mutations correctly', () => {
    const mutations = savvycalConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'events.create',
        'events.cancel',
        'links.delete',
        'links.duplicate',
        'links.toggle',
      ].sort(),
    )
  })

  it('classifies reads correctly', () => {
    const reads = savvycalConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('user.current')
    expect(reads).toContain('events.list')
    expect(reads).toContain('events.get')
    expect(reads).toContain('events.findByEmail')
    expect(reads).toContain('links.list')
    expect(reads).toContain('links.get')
    expect(reads).toContain('links.slots')
    expect(reads).toContain('workflows.list')
    expect(reads).toContain('workflows.rules')
  })
})
