import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleTasksConnector } from '../src/connectors/adapters/google-tasks.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_google_tasks',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'google-tasks',
  label: 'Google Tasks',
  consistencyModel: 'authoritative',
  scopes: ['https://www.googleapis.com/auth/tasks'],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('google-tasks adapter manifest', () => {
  it('classifies itself as kind=google-tasks, category=doc, oauth2 auth', () => {
    expect(googleTasksConnector.manifest.kind).toBe('google-tasks')
    expect(googleTasksConnector.manifest.category).toBe('doc')
    expect(googleTasksConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(googleTasksConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('declares capabilities covering tasklists, tasks, read and write operations', () => {
    const names = googleTasksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'tasklists.get',
      'tasklists.list',
      'tasks.create',
      'tasks.delete',
      'tasks.get',
      'tasks.list',
      'tasks.update',
    ])
  })
})
