import { describe, expect, it } from 'vitest'
import { apitemplateIoConnector } from '../src/connectors/adapters/apitemplate-io.js'

describe('apitemplate-io adapter manifest', () => {
  it('exposes the apitemplate-io kind and storage category from the catalog', () => {
    expect(apitemplateIoConnector.manifest.kind).toBe('apitemplate-io')
    expect(apitemplateIoConnector.manifest.category).toBe('storage')
    expect(apitemplateIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = apitemplateIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: account, list, create image/pdf/html/url, delete', () => {
    const names = apitemplateIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.get',
        'objects.list',
        'image.create',
        'pdf.create',
        'pdf.createFromHtml',
        'pdf.createFromUrl',
        'object.delete',
      ].sort(),
    )
    const reads = apitemplateIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['account.get', 'objects.list'].sort())
  })
})
