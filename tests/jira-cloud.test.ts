import { describe, expect, it } from 'vitest'
import { jiraCloudConnector } from '../src/connectors/adapters/jira-cloud.js'

describe('jira-cloud adapter manifest', () => {
  it('exposes the jira-cloud kind in the doc category', () => {
    expect(jiraCloudConnector.manifest.kind).toBe('jira-cloud')
    expect(jiraCloudConnector.manifest.displayName).toBe('Jira Cloud')
    expect(jiraCloudConnector.manifest.category).toBe('doc')
    expect(jiraCloudConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (the activepieces catalog records auth = "api_key" for Jira Cloud)', () => {
    const auth = jiraCloudConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
    expect(auth.hint.length).toBeGreaterThan(0)
  })

  it('covers the core issue lifecycle plus comments, attachments, users', () => {
    const names = jiraCloudConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'issues.create',
        'issues.search',
        'issues.get',
        'issues.update',
        'issues.assign',
        'issues.transition',
        'issues.link',
        'issues.watchers.add',
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'attachments.get',
        'users.find',
      ].sort(),
    )
    const reads = jiraCloudConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = jiraCloudConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['attachments.get', 'comments.list', 'issues.get', 'issues.search', 'users.find'])
    expect(mutations).toEqual(
      [
        'comments.create',
        'comments.delete',
        'comments.update',
        'issues.assign',
        'issues.create',
        'issues.link',
        'issues.transition',
        'issues.update',
        'issues.watchers.add',
      ].sort(),
    )
  })
})
