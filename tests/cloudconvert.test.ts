import { describe, expect, it } from 'vitest'
import { cloudconvertConnector } from '../src/connectors/adapters/cloudconvert.js'

describe('cloudconvert adapter manifest', () => {
  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cloudconvertConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
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
