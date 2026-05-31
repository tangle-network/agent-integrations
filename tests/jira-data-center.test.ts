import { describe, expect, it } from 'vitest'
import { jiraDataCenterConnector } from '../src/connectors/adapters/jira-data-center.js'

describe('jira-data-center adapter manifest', () => {
  it('exposes the jira-data-center kind and the doc category mapped from the catalog', () => {
    expect(jiraDataCenterConnector.manifest.kind).toBe('jira-data-center')
    expect(jiraDataCenterConnector.manifest.category).toBe('doc')
    expect(jiraDataCenterConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog (PAT + instance URL)', () => {
    const auth = jiraDataCenterConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action surface: issues, comments, attachments, users', () => {
    const names = jiraDataCenterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'issues.create',
        'issues.search',
        'issues.get',
        'issues.update',
        'issues.assign',
        'issues.link',
        'issues.addWatcher',
        'issues.addAttachment',
        'issues.getAttachment',
        'comments.list',
        'comments.add',
        'comments.update',
        'comments.delete',
        'users.find',
      ].sort(),
    )
  })

  it('classifies destructive comment deletion as a mutation and search/get as reads', () => {
    const reads = jiraDataCenterConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = jiraDataCenterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'issues.search',
        'issues.get',
        'issues.getAttachment',
        'comments.list',
        'users.find',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'issues.create',
        'issues.update',
        'issues.assign',
        'issues.link',
        'issues.addWatcher',
        'issues.addAttachment',
        'comments.add',
        'comments.update',
        'comments.delete',
      ].sort(),
    )
  })
})
