import { describe, expect, it } from 'vitest'
import { lokaliseConnector } from '../src/connectors/adapters/lokalise.js'

describe('lokalise adapter manifest', () => {
  it('exposes the lokalise kind and a workflow-style category', () => {
    expect(lokaliseConnector.manifest.kind).toBe('lokalise')
    expect(lokaliseConnector.manifest.category).toBe('other')
    expect(lokaliseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = lokaliseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action surface: projects, keys, translations, tasks, comments', () => {
    const names = lokaliseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'projects.create',
        'projects.get',
        'keys.create',
        'keys.get',
        'keys.update',
        'keys.delete',
        'translations.get',
        'translations.update',
        'tasks.create',
        'comments.create',
        'comments.get',
      ].sort(),
    )
    const reads = lokaliseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = lokaliseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['projects.get', 'keys.get', 'translations.get', 'comments.get'].sort(),
    )
    expect(mutations).toEqual(
      [
        'projects.create',
        'keys.create',
        'keys.update',
        'keys.delete',
        'translations.update',
        'tasks.create',
        'comments.create',
      ].sort(),
    )
  })
})
