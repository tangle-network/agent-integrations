import { describe, expect, it } from 'vitest'
import { wrikeConnector } from '../src/connectors/adapters/wrike.js'

describe('wrike adapter manifest', () => {
  it('classifies itself as the other category and exposes the wrike kind', () => {
    expect(wrikeConnector.manifest.kind).toBe('wrike')
    expect(wrikeConnector.manifest.category).toBe('other')
    expect(wrikeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth', () => {
    const auth = wrikeConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (tasks, folders, projects, comments, attachments)', () => {
    const names = wrikeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tasks.create',
        'tasks.update',
        'folders.create',
        'projects.create',
        'comments.add',
        'attachments.upload',
        'tasks.find',
        'folders.find',
      ].sort(),
    )
    const reads = wrikeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = wrikeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['folders.find', 'tasks.find'].sort())
    expect(mutations).toEqual(
      [
        'attachments.upload',
        'comments.add',
        'folders.create',
        'projects.create',
        'tasks.create',
        'tasks.update',
      ].sort(),
    )
  })
})
