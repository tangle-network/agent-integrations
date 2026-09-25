import { describe, expect, it } from 'vitest'
import { avianConnector } from '../src/connectors/adapters/avian.js'

describe('avian adapter manifest', () => {
  it('declares an api-key auth surface (Avian uses a Bearer API key, not OAuth)', () => {
    const auth = avianConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

})
