import { describe, expect, it } from 'vitest'
import { facebookLeadsConnector } from '../src/connectors/adapters/facebook-leads.js'

describe('facebook-leads adapter manifest', () => {
  it('classifies itself as the crm category and exposes the facebook-leads kind', () => {
    expect(facebookLeadsConnector.manifest.kind).toBe('facebook-leads')
    expect(facebookLeadsConnector.manifest.category).toBe('crm')
    expect(facebookLeadsConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = facebookLeadsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes the Graph lead-gen read surface plus webhook subscription management', () => {
    const names = facebookLeadsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.me',
        'pages.list',
        'forms.list',
        'forms.get',
        'forms.leads.list',
        'leads.get',
        'page.subscriptions.list',
        'page.subscriptions.create',
        'page.subscriptions.delete',
      ].sort(),
    )
    const mutations = facebookLeadsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['page.subscriptions.create', 'page.subscriptions.delete'].sort(),
    )
  })
})
