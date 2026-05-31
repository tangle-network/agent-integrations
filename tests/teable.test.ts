import { describe, expect, it } from 'vitest'
import { teableConnector } from '../src/connectors/adapters/teable.js'

describe('teable adapter manifest', () => {
  it('classifies itself as the doc category and exposes the teable kind', () => {
    expect(teableConnector.manifest.kind).toBe('teable')
    expect(teableConnector.manifest.category).toBe('doc')
    expect(teableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = teableConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (records + attachments)', () => {
    const names = teableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.create',
        'records.find',
        'records.get',
        'records.update',
        'records.delete',
        'attachments.upload',
      ].sort(),
    )
    const reads = teableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = teableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.find', 'records.get'].sort())
    expect(mutations).toEqual(
      ['records.create', 'records.update', 'records.delete', 'attachments.upload'].sort(),
    )
  })
})
