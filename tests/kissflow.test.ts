import { describe, expect, it } from 'vitest'
import { kissflowConnector } from '../src/connectors/adapters/kissflow.js'

describe('kissflow adapter manifest', () => {
  it('classifies itself as the doc category and exposes the kissflow kind', () => {
    expect(kissflowConnector.manifest.kind).toBe('kissflow')
    expect(kissflowConnector.manifest.category).toBe('doc')
    expect(kissflowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = kissflowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/kissflow/i)
  })

  it('exposes the download attachment from form field read capability', () => {
    const names = kissflowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['download.attachment.from.form.field'])
    const reads = kissflowConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['download.attachment.from.form.field'])
  })
})
