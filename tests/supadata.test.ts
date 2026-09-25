import { describe, expect, it } from 'vitest'
import { supadataConnector } from '../src/connectors/adapters/supadata.js'

describe('supadata adapter manifest', () => {
  it('declares api-key auth with a Supadata-specific hint', () => {
    const auth = supadataConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Supadata/i)
  })

})
