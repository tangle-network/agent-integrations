import { describe, expect, it } from 'vitest'
import { giteaConnector } from '../src/connectors/adapters/gitea.js'

describe('gitea adapter manifest', () => {
  it('classifies itself as the other category and exposes the gitea kind', () => {
    expect(giteaConnector.manifest.kind).toBe('gitea')
    expect(giteaConnector.manifest.category).toBe('other')
    expect(giteaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = giteaConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action and trigger set', () => {
    const names = giteaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'repos.list',
        'issues.create',
        'issues.update',
        'comments.create',
        'pull-requests.list',
        'pull-requests.create',
        'branches.list',
      ].sort(),
    )
    const reads = giteaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = giteaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['repos.list', 'pull-requests.list', 'branches.list'].sort(),
    )
    expect(mutations).toEqual(
      ['issues.create', 'issues.update', 'comments.create', 'pull-requests.create'].sort(),
    )
  })
})
