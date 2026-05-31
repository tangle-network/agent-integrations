import { describe, expect, it } from 'vitest'
import { flowParserConnector } from '../src/connectors/adapters/flow-parser.js'

describe('flow-parser adapter manifest', () => {
  it('classifies itself as the other category and exposes the flow-parser kind', () => {
    expect(flowParserConnector.manifest.kind).toBe('flow-parser')
    expect(flowParserConnector.manifest.category).toBe('other')
    expect(flowParserConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = flowParserConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })
})
