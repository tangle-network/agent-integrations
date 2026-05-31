import { describe, expect, it } from 'vitest'
import { leadConnectorConnector } from '../src/connectors/adapters/lead-connector.js'

describe('lead-connector adapter manifest', () => {
  it('classifies itself as the crm category and exposes the lead-connector kind', () => {
    expect(leadConnectorConnector.manifest.kind).toBe('lead-connector')
    expect(leadConnectorConnector.manifest.category).toBe('crm')
    expect(leadConnectorConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = leadConnectorConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action set (contacts, opportunities, tasks, notes, campaigns, workflows)', () => {
    const names = leadConnectorConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.search',
        'contacts.notes.add',
        'contacts.campaigns.add',
        'contacts.workflows.add',
        'opportunities.create',
        'opportunities.update',
        'tasks.create',
        'tasks.update',
      ].sort(),
    )
    const reads = leadConnectorConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = leadConnectorConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.search'])
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.notes.add',
        'contacts.campaigns.add',
        'contacts.workflows.add',
        'opportunities.create',
        'opportunities.update',
        'tasks.create',
        'tasks.update',
      ].sort(),
    )
  })
})
