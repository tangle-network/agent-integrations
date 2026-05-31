import { describe, expect, it } from 'vitest'
import { supadataConnector } from '../src/connectors/adapters/supadata.js'

describe('supadata adapter manifest', () => {
  it('classifies itself as the other category and exposes the supadata kind', () => {
    expect(supadataConnector.manifest.kind).toBe('supadata')
    expect(supadataConnector.manifest.category).toBe('other')
    expect(supadataConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Supadata-specific hint', () => {
    const auth = supadataConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Supadata/i)
  })

  it('exposes transcript extraction capability', () => {
    const names = supadataConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('transcript.get')
  })

  it('marks transcript extraction as read-only', () => {
    const transcript = supadataConnector.manifest.capabilities.find((c) => c.name === 'transcript.get')
    expect(transcript).toBeDefined()
    expect(transcript?.class).toBe('read')
  })
})
