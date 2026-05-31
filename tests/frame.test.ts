import { describe, expect, it } from 'vitest'
import { frameConnector } from '../src/connectors/adapters/frame.js'

describe('frame adapter manifest', () => {
  it('classifies itself as the crm category and exposes the frame kind', () => {
    expect(frameConnector.manifest.kind).toBe('frame')
    expect(frameConnector.manifest.category).toBe('crm')
    expect(frameConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = frameConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the documented Frame.io v2 surface: accounts/teams/projects nav plus asset, comment, review-link CRUD', () => {
    const names = frameConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'accounts.list',
        'teams.list',
        'projects.list',
        'projects.get',
        'assets.list',
        'assets.get',
        'assets.create',
        'assets.update',
        'assets.delete',
        'comments.list',
        'comments.create',
        'comments.update',
        'reviewLinks.list',
        'reviewLinks.create',
      ].sort(),
    )
    const reads = frameConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = frameConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'accounts.list',
        'teams.list',
        'projects.list',
        'projects.get',
        'assets.list',
        'assets.get',
        'comments.list',
        'reviewLinks.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'assets.create',
        'assets.update',
        'assets.delete',
        'comments.create',
        'comments.update',
        'reviewLinks.create',
      ].sort(),
    )
  })
})
