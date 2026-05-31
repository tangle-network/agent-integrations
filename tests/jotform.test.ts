import { describe, expect, it } from 'vitest'
import { jotformConnector } from '../src/connectors/adapters/jotform.js'

describe('jotform adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the jotform kind', () => {
    expect(jotformConnector.manifest.kind).toBe('jotform')
    expect(jotformConnector.manifest.category).toBe('webhook')
    expect(jotformConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = jotformConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the REST surface that backs the New Submission trigger and the read paths agents need', () => {
    const names = jotformConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'forms.list',
        'form.get',
        'form.questions',
        'form.submissions.list',
        'submission.get',
        'form.webhooks.list',
        'submission.create',
        'submission.update',
        'submission.delete',
        'form.webhooks.create',
        'form.webhooks.delete',
      ].sort(),
    )
    const reads = jotformConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = jotformConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'forms.list',
        'form.get',
        'form.questions',
        'form.submissions.list',
        'submission.get',
        'form.webhooks.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'submission.create',
        'submission.update',
        'submission.delete',
        'form.webhooks.create',
        'form.webhooks.delete',
      ].sort(),
    )
  })
})
