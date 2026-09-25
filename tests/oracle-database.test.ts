import { describe, expect, it } from 'vitest'
import { oracleDatabaseConnector } from '../src/connectors/adapters/oracle-database.js'

describe('oracle-database adapter manifest', () => {
  it('uses api-key auth', () => {
    const auth = oracleDatabaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})
