import { describe, expect, it } from 'vitest'
import { clockifyConnector } from '../src/connectors/adapters/clockify.js'

describe('clockify adapter manifest', () => {
  it('classifies itself as the other category and exposes the clockify kind', () => {
    expect(clockifyConnector.manifest.kind).toBe('clockify')
    expect(clockifyConnector.manifest.category).toBe('other')
    expect(clockifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = clockifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (tasks, time entries, timers)', () => {
    const names = clockifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'task.create',
        'time.entry.create',
        'timer.running.find',
        'task.find',
        'time.entry.find',
        'timer.start',
        'timer.stop',
      ].sort(),
    )
    const reads = clockifyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clockifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['task.find', 'time.entry.find', 'timer.running.find'].sort())
    expect(mutations).toEqual(
      ['task.create', 'time.entry.create', 'timer.start', 'timer.stop'].sort(),
    )
  })
})
