import { describe, expect, it } from 'vitest'
import { opnformConnector } from '../src/connectors/adapters/opnform.js'

describe('opnform adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the opnform kind', () => {
    expect(opnformConnector.manifest.kind).toBe('opnform')
    expect(opnformConnector.manifest.category).toBe('webhook')
    expect(opnformConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = opnformConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Opnform/i)
  })

  it('covers form and submission capability surface', () => {
    const names = opnformConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'forms.get',
        'forms.list',
        'submissions.get',
        'submissions.list',
        'webhooks.configure',
      ].sort(),
    )
    const mutations = opnformConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['webhooks.configure'])
  })
})
