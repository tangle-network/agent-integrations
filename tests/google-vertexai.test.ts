import { describe, expect, it } from 'vitest'
import { googleVertexaiConnector } from '../src/connectors/adapters/google-vertexai.js'

describe('google-vertexai adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = googleVertexaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Google Cloud/i)
  })

})
