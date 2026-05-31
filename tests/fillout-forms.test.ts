import { describe, expect, it } from 'vitest'
import { filloutFormsConnector } from '../src/connectors/adapters/fillout-forms.js'

describe('fillout-forms adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the fillout-forms kind', () => {
    expect(filloutFormsConnector.manifest.kind).toBe('fillout-forms')
    expect(filloutFormsConnector.manifest.category).toBe('webhook')
    expect(filloutFormsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = filloutFormsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: form discovery, submissions, and webhook trigger plumbing', () => {
    const names = filloutFormsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'find.form.by.title',
        'form.metadata',
        'forms.list',
        'get.form.responses',
        'get.single.response',
        'webhooks.create',
        'webhooks.delete',
      ].sort(),
    )
    const reads = filloutFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = filloutFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['find.form.by.title', 'form.metadata', 'forms.list', 'get.form.responses', 'get.single.response'].sort(),
    )
    expect(mutations).toEqual(['webhooks.create', 'webhooks.delete'].sort())
  })
})
