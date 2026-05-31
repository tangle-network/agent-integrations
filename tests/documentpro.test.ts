import { describe, expect, it } from 'vitest'
import { documentproConnector } from '../src/connectors/adapters/documentpro.js'

describe('documentpro adapter manifest', () => {
  it('classifies itself under the doc category and exposes the documentpro kind', () => {
    expect(documentproConnector.manifest.kind).toBe('documentpro')
    expect(documentproConnector.manifest.category).toBe('doc')
    expect(documentproConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (DocumentPro has no OAuth flow)', () => {
    const auth = documentproConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the run.extract capability from the activepieces catalog', () => {
    const names = documentproConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['run.extract'])
    const extract = documentproConnector.manifest.capabilities.find((c) => c.name === 'run.extract')
    if (!extract) throw new Error('run.extract capability missing')
    expect(extract.class).toBe('mutation')
  })
})
