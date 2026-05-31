import { describe, expect, it } from 'vitest'
import { zapierConnector } from '../src/connectors/adapters/zapier.js'

describe('zapier adapter manifest', () => {
  it('exposes the zapier kind in the other category', () => {
    expect(zapierConnector.manifest.kind).toBe('zapier')
    expect(zapierConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (account-scoped bearer token)', () => {
    expect(zapierConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers catch-hook trigger and the Zaps management surface', () => {
    const names = zapierConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['triggers.catch', 'zaps.get', 'zaps.list'].sort())
  })
})
