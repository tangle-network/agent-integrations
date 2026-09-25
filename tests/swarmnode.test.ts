import { describe, expect, it } from 'vitest'
import { swarmnodeConnector } from '../src/connectors/adapters/swarmnode.js'

describe('swarmnode adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = swarmnodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})
