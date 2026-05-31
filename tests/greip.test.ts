import { describe, expect, it } from 'vitest'
import { greipConnector } from '../src/connectors/adapters/greip.js'

describe('greip adapter manifest', () => {
  it('classifies itself under other and exposes the greip kind', () => {
    expect(greipConnector.manifest.kind).toBe('greip')
    expect(greipConnector.manifest.category).toBe('other')
    expect(greipConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = greipConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: ip/asn/bin lookups + validations + profanity', () => {
    const names = greipConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'asn.lookup',
        'bin.lookup',
        'email.validation',
        'ip.lookup',
        'phone.validation',
        'profanity.detection',
      ].sort(),
    )
    const classes = new Set(greipConnector.manifest.capabilities.map((c) => c.class))
    expect(classes.has('read')).toBe(true)
  })
})
