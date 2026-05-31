import { describe, expect, it } from 'vitest'
import { togglTrackConnector } from '../src/connectors/adapters/toggl-track.js'

describe('toggl-track adapter manifest', () => {
  it('classifies itself as the other category and exposes the toggl-track kind', () => {
    expect(togglTrackConnector.manifest.kind).toBe('toggl-track')
    expect(togglTrackConnector.manifest.category).toBe('other')
    expect(togglTrackConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Toggl Track-specific hint', () => {
    const auth = togglTrackConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Toggl Track/i)
  })

  it('covers clients, projects, tasks, tags, time entries, and user capabilities', () => {
    const names = togglTrackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('clients.create')
    expect(names).toContain('clients.find')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.find')
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.find')
    expect(names).toContain('tags.create')
    expect(names).toContain('tags.find')
    expect(names).toContain('time-entries.create')
    expect(names).toContain('time-entries.start')
    expect(names).toContain('time-entries.stop')
    expect(names).toContain('time-entries.find')
    expect(names).toContain('user.find')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = togglTrackConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('clients.create')
    expect(mutations).toContain('projects.create')
    expect(mutations).toContain('tasks.create')
    expect(mutations).toContain('tags.create')
    expect(mutations).toContain('time-entries.create')
    expect(mutations).toContain('time-entries.start')
    expect(mutations).toContain('time-entries.stop')
  })

  it('marks read-only operations as read', () => {
    const reads = togglTrackConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('clients.find')
    expect(reads).toContain('projects.find')
    expect(reads).toContain('tasks.find')
    expect(reads).toContain('tags.find')
    expect(reads).toContain('time-entries.find')
    expect(reads).toContain('user.find')
  })
})
