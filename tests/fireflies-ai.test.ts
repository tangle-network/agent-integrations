import { describe, expect, it } from 'vitest'
import { firefliesAiConnector } from '../src/connectors/adapters/fireflies-ai.js'

describe('fireflies-ai adapter manifest', () => {
  it('exposes the fireflies-ai kind under the doc category', () => {
    expect(firefliesAiConnector.manifest.kind).toBe('fireflies-ai')
    expect(firefliesAiConnector.manifest.category).toBe('doc')
    expect(firefliesAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = firefliesAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (find/upload/get-user)', () => {
    const names = firefliesAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.findById',
        'meetings.findRecent',
        'meetings.findByQuery',
        'audio.upload',
        'user.getDetails',
      ].sort(),
    )
    const reads = firefliesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = firefliesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['meetings.findById', 'meetings.findRecent', 'meetings.findByQuery', 'user.getDetails'].sort(),
    )
    expect(mutations).toEqual(['audio.upload'])
  })
})
