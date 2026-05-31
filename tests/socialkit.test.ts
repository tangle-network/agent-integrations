import { describe, expect, it } from 'vitest'
import { socialkitConnector } from '../src/connectors/adapters/socialkit.js'

describe('socialkit adapter manifest', () => {
  it('classifies itself as the storage category and exposes the socialkit kind', () => {
    expect(socialkitConnector.manifest.kind).toBe('socialkit')
    expect(socialkitConnector.manifest.category).toBe('storage')
    expect(socialkitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Socialkit-specific hint', () => {
    const auth = socialkitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Socialkit/i)
  })

  it('covers youtube details, transcript, summary, and comments capability surface', () => {
    const names = socialkitConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('youtube.details')
    expect(names).toContain('youtube.transcript')
    expect(names).toContain('youtube.summary')
    expect(names).toContain('youtube.comments')
  })

  it('marks all operations as read-only', () => {
    const reads = socialkitConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    expect(reads).toHaveLength(4)
    expect(reads).toContain('youtube.details')
    expect(reads).toContain('youtube.transcript')
    expect(reads).toContain('youtube.summary')
    expect(reads).toContain('youtube.comments')
  })
})
