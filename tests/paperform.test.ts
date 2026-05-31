import { describe, expect, it } from 'vitest'
import { paperformConnector } from '../src/connectors/adapters/paperform.js'

describe('paperform adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the paperform kind', () => {
    expect(paperformConnector.manifest.kind).toBe('paperform')
    expect(paperformConnector.manifest.category).toBe('webhook')
    expect(paperformConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = paperformConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Paperform/i)
  })

  it('covers space, form, submission, product, and coupon capability surface', () => {
    const names = paperformConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'coupons.create',
        'coupons.delete',
        'coupons.update',
        'forms.find',
        'partial_submissions.delete',
        'products.create',
        'products.delete',
        'products.find',
        'products.update',
        'spaces.create',
        'spaces.find',
        'spaces.update',
        'submissions.delete',
        'submissions.find',
      ].sort(),
    )
    const mutations = paperformConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'coupons.create',
        'coupons.delete',
        'coupons.update',
        'partial_submissions.delete',
        'products.create',
        'products.delete',
        'products.update',
        'spaces.create',
        'spaces.update',
        'submissions.delete',
      ].sort(),
    )
  })
})
