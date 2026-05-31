import { describe, expect, it } from 'vitest'
import { microsoftTodoConnector } from '../src/connectors/adapters/microsoft-todo.js'

describe('microsoft-todo adapter manifest', () => {
  it('classifies itself as the other category and exposes the microsoft-todo kind', () => {
    expect(microsoftTodoConnector.manifest.kind).toBe('microsoft-todo')
    expect(microsoftTodoConnector.manifest.category).toBe('other')
    expect(microsoftTodoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = microsoftTodoConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action set (add-attachment/complete/create/create-list/delete/find/get/update/update-list/list)', () => {
    const names = microsoftTodoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'taskLists.list',
        'taskLists.findByName',
        'taskLists.create',
        'taskLists.update',
        'tasks.list',
        'tasks.get',
        'tasks.findByTitle',
        'tasks.create',
        'tasks.update',
        'tasks.complete',
        'tasks.delete',
        'tasks.addAttachment',
      ].sort(),
    )
  })
})
