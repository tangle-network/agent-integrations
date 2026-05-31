import { describe, expect, it } from 'vitest'
import { kizeoFormsConnector } from '../src/connectors/adapters/kizeo-forms.js'

describe('kizeo-forms adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the kizeo-forms kind', () => {
    expect(kizeoFormsConnector.manifest.kind).toBe('kizeo-forms')
    expect(kizeoFormsConnector.manifest.category).toBe('webhook')
    expect(kizeoFormsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = kizeoFormsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (lists, exports, data definitions, push)', () => {
    const names = kizeoFormsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.list.item',
        'delete.list.item',
        'download.custom.export.in.its.original.format',
        'download.standard.pdf',
        'edit.list.item',
        'get.all.list.items',
        'get.data.definition',
        'get.list.definition',
        'get.list.item',
        'push.data',
      ].sort(),
    )
    const reads = kizeoFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kizeoFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'download.custom.export.in.its.original.format',
        'download.standard.pdf',
        'get.all.list.items',
        'get.data.definition',
        'get.list.definition',
        'get.list.item',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['create.list.item', 'delete.list.item', 'edit.list.item', 'push.data'].sort(),
    )
  })
})
