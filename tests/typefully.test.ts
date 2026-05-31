import { describe, expect, it } from 'vitest'
import { typefullyConnector } from '../src/connectors/adapters/typefully.js'

describe('typefully adapter manifest', () => {
  it('classifies itself as the crm category and exposes the typefully kind', () => {
    expect(typefullyConnector.manifest.kind).toBe('typefully')
    expect(typefullyConnector.manifest.category).toBe('crm')
    expect(typefullyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = typefullyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: draft management and publishing', () => {
    const names = typefullyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'drafts.create',
      'drafts.createAdvanced',
      'drafts.delete',
      'drafts.get',
      'drafts.list',
      'drafts.publishNow',
      'drafts.schedule',
      'media.upload',
    ])
    const mutations = typefullyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([
      'drafts.create',
      'drafts.createAdvanced',
      'drafts.delete',
      'drafts.publishNow',
      'drafts.schedule',
      'media.upload',
    ])
  })
})
