import { describe, expect, it } from 'vitest'
import { featheryConnector } from '../src/connectors/adapters/feathery.js'

describe('feathery adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the feathery kind', () => {
    expect(featheryConnector.manifest.kind).toBe('feathery')
    expect(featheryConnector.manifest.category).toBe('webhook')
    expect(featheryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = featheryConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Feathery/i)
  })

  it('covers form creation, updates, deletion, submission listing, and PDF export capability surfaces', () => {
    const names = featheryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'forms.create',
        'forms.update',
        'forms.delete',
        'submissions.list',
        'submissions.export',
      ].sort(),
    )
    const mutations = featheryConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['forms.create', 'forms.update', 'forms.delete', 'submissions.export'].sort())
  })
})
