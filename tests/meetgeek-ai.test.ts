import { describe, expect, it } from 'vitest'
import { meetgeekAiConnector } from '../src/connectors/adapters/meetgeek-ai.js'

describe('meetgeek-ai adapter manifest', () => {
  it('classifies itself as the meetgeek-ai kind and falls back to the other category', () => {
    // The catalog tags MeetGeek as `workflow`, which is not in our manifest
    // category union; `other` is the canonical fallback for productivity-ish
    // tools that do not fit calendar/doc/comms cleanly.
    expect(meetgeekAiConnector.manifest.kind).toBe('meetgeek-ai')
    expect(meetgeekAiConnector.manifest.category).toBe('other')
    expect(meetgeekAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = meetgeekAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: list/get/transcript/highlights/insights + upload', () => {
    const names = meetgeekAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.transcript',
        'meetings.highlights',
        'meetings.summaryInsights',
        'recordings.upload',
      ].sort(),
    )
    const reads = meetgeekAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = meetgeekAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.transcript',
        'meetings.highlights',
        'meetings.summaryInsights',
      ].sort(),
    )
    expect(mutations).toEqual(['recordings.upload'])
  })
})
