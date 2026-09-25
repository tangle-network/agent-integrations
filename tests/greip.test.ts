import { describe, expect, it } from 'vitest'
import { greipConnector } from '../src/connectors/adapters/greip.js'

describe('greip adapter manifest', () => {
  it('declares api-key auth as the catalog says', () => {
    const auth = greipConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})
