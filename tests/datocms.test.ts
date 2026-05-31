import { describe, expect, it } from 'vitest'
import { datocmsConnector } from '../src/connectors/adapters/datocms.js'

describe('datocms adapter manifest', () => {
  it('classifies itself as the doc category and exposes the datocms kind', () => {
    expect(datocmsConnector.manifest.kind).toBe('datocms')
    expect(datocmsConnector.manifest.category).toBe('doc')
    expect(datocmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = datocmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the documented CMA resource surface (items, item types, uploads, environments, users, webhooks)', () => {
    const names = datocmsConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('site.get')
    expect(names).toContain('items.list')
    expect(names).toContain('items.get')
    expect(names).toContain('items.create')
    expect(names).toContain('items.update')
    expect(names).toContain('items.delete')
    expect(names).toContain('items.publish')
    expect(names).toContain('items.unpublish')
    expect(names).toContain('itemTypes.list')
    expect(names).toContain('itemTypes.get')
    expect(names).toContain('uploads.list')
    expect(names).toContain('uploads.create')
    expect(names).toContain('uploads.requestUrl')
    expect(names).toContain('environments.list')
    expect(names).toContain('environments.fork')
    expect(names).toContain('users.list')
    expect(names).toContain('webhooks.list')
    expect(names).toContain('webhooks.create')
    expect(names).toContain('webhooks.delete')
  })

  it('partitions capabilities into reads and mutations', () => {
    const reads = datocmsConnector.manifest.capabilities.filter((c) => c.class === 'read')
    const mutations = datocmsConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(reads.length).toBeGreaterThan(0)
    expect(mutations.length).toBeGreaterThan(0)
    expect(reads.map((c) => c.name)).toContain('items.list')
    expect(mutations.map((c) => c.name)).toContain('items.create')
  })
})
