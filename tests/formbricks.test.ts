import { describe, expect, it } from 'vitest'
import { formbricksConnector } from '../src/connectors/adapters/formbricks.js'

describe('formbricks adapter manifest', () => {
  it('classifies itself as the database category and exposes the formbricks kind', () => {
    expect(formbricksConnector.manifest.kind).toBe('formbricks')
    expect(formbricksConnector.manifest.category).toBe('database')
    expect(formbricksConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = formbricksConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the Formbricks Management API surface (surveys, responses, contacts)', () => {
    const names = formbricksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'surveys.list',
        'surveys.get',
        'responses.list',
        'responses.get',
        'responses.delete',
        'contacts.list',
        'contacts.get',
        'contacts.create',
        'contacts.update',
        'contacts.delete',
      ].sort(),
    )
    const reads = formbricksConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = formbricksConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['contacts.get', 'contacts.list', 'responses.get', 'responses.list', 'surveys.get', 'surveys.list'].sort(),
    )
    expect(mutations).toEqual(
      ['contacts.create', 'contacts.delete', 'contacts.update', 'responses.delete'].sort(),
    )
  })
})
