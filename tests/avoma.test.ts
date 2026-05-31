import { describe, expect, it } from 'vitest'
import { avomaConnector } from '../src/connectors/adapters/avoma.js'

describe('avoma adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the avoma kind', () => {
    expect(avomaConnector.manifest.kind).toBe('avoma')
    expect(avomaConnector.manifest.category).toBe('calendar')
    expect(avomaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = avomaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: create call and fetch meeting transcripts/recordings', () => {
    const names = avomaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['calls.create', 'meetings.transcription.get', 'meetings.recording.get'].sort(),
    )
    const reads = avomaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = avomaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['meetings.recording.get', 'meetings.transcription.get'])
    expect(mutations).toEqual(['calls.create'])
  })
})
