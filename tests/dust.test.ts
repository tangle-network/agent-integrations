import { describe, expect, it } from 'vitest'
import { dustConnector } from '../src/connectors/adapters/dust.js'

describe('dust adapter manifest', () => {
  it('exposes the dust kind and groups into the other category (catalog lists it under "workflow")', () => {
    expect(dustConnector.manifest.kind).toBe('dust')
    expect(dustConnector.manifest.category).toBe('other')
    expect(dustConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the activepieces catalog', () => {
    const auth = dustConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: conversation create/reply/get, fragment + file upload, document upsert', () => {
    const names = dustConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'conversations.create',
        'conversations.reply',
        'conversations.get',
        'conversations.addFragment',
        'files.upload',
        'documents.upsert',
      ].sort(),
    )
    const reads = dustConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = dustConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['conversations.get'])
    expect(mutations).toEqual(
      [
        'conversations.create',
        'conversations.reply',
        'conversations.addFragment',
        'files.upload',
        'documents.upsert',
      ].sort(),
    )
  })
})
