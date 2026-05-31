import { describe, expect, it } from 'vitest'
import { gristConnector } from '../src/connectors/adapters/grist.js'

describe('grist adapter manifest', () => {
  it('classifies itself under the doc category and exposes the grist kind', () => {
    expect(gristConnector.manifest.kind).toBe('grist')
    expect(gristConnector.manifest.category).toBe('doc')
    expect(gristConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface with domain URL hint', () => {
    const auth = gristConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Grist/i)
    expect(auth.hint).toMatch(/Domain/)
  })

  it('covers create, update, search, and attachment upload capabilities', () => {
    const names = gristConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['records.create', 'records.update', 'records.search', 'attachments.upload'].sort()
    )

    const reads = gristConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = gristConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.search'].sort())
    expect(mutations).toEqual(['records.create', 'records.update', 'attachments.upload'].sort())
  })
})
