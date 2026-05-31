import { describe, expect, it } from 'vitest'
import { cloudconvertConnector } from '../src/connectors/adapters/cloudconvert.js'

describe('cloudconvert adapter manifest', () => {
  it('exposes the cloudconvert kind with authoritative consistency', () => {
    expect(cloudconvertConnector.manifest.kind).toBe('cloudconvert')
    expect(cloudconvertConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses other category (activepieces "workflow" has no direct manifest enum)', () => {
    expect(cloudconvertConnector.manifest.category).toBe('other')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cloudconvertConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (convert, capture, merge, download, archive, optimize)', () => {
    const names = cloudconvertConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'convert.file',
        'capture.website',
        'merge.pdf',
        'download.file',
        'archive.file',
        'optimize.file',
      ]),
    )
  })

  it('classifies download.file as a read and the mutating actions as mutations', () => {
    const byName = new Map(cloudconvertConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('download.file')?.class).toBe('read')
    expect(byName.get('convert.file')?.class).toBe('mutation')
    expect(byName.get('capture.website')?.class).toBe('mutation')
    expect(byName.get('merge.pdf')?.class).toBe('mutation')
    expect(byName.get('archive.file')?.class).toBe('mutation')
    expect(byName.get('optimize.file')?.class).toBe('mutation')
  })
})
