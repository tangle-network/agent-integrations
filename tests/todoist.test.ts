import { describe, expect, it } from 'vitest'
import { todoistConnector } from '../src/connectors/adapters/todoist.js'

describe('todoist adapter manifest', () => {
  it('classifies itself as the doc category and exposes the todoist kind', () => {
    expect(todoistConnector.manifest.kind).toBe('todoist')
    expect(todoistConnector.manifest.category).toBe('doc')
    expect(todoistConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth', () => {
    const auth = todoistConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (tasks and projects)', () => {
    const names = todoistConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tasks.create',
        'tasks.update',
        'tasks.get',
        'tasks.list',
        'tasks.complete',
        'tasks.delete',
        'projects.list',
      ].sort(),
    )
    const reads = todoistConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = todoistConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['projects.list', 'tasks.get', 'tasks.list'].sort())
    expect(mutations).toEqual(
      ['tasks.complete', 'tasks.create', 'tasks.delete', 'tasks.update'].sort(),
    )
  })
})
