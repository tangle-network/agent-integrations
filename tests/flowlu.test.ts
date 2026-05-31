import { describe, expect, it } from 'vitest'
import { flowluConnector } from '../src/connectors/adapters/flowlu.js'

describe('flowlu adapter manifest', () => {
  it('classifies itself as the crm category and exposes the flowlu kind', () => {
    expect(flowluConnector.manifest.kind).toBe('flowlu')
    expect(flowluConnector.manifest.category).toBe('crm')
    expect(flowluConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = flowluConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts, organizations, opportunities, tasks)', () => {
    const names = flowluConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contact.create',
        'contact.update',
        'contact.delete',
        'organization.create',
        'opportunity.create',
        'opportunity.update',
        'opportunity.delete',
        'task.create',
        'task.update',
        'task.delete',
        'task.get',
      ].sort(),
    )
    const reads = flowluConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = flowluConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['task.get'].sort())
    expect(mutations).toEqual(
      [
        'contact.create',
        'contact.update',
        'contact.delete',
        'organization.create',
        'opportunity.create',
        'opportunity.update',
        'opportunity.delete',
        'task.create',
        'task.update',
        'task.delete',
      ].sort(),
    )
  })
})
