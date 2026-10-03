import { declarativeRestConnector } from './declarative-rest.js'

export const gtmAgentConnector = declarativeRestConnector({
  kind: 'gtm-agent',
  displayName: 'GTM Agent reports',
  description: 'Read acquisition outcomes for one authorized campaign and visitor cohort.',
  auth: { kind: 'api-key', hint: 'Connect an expiring campaign report from GTM Agent’s Campaign performance page.' },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://gtm.tangle.tools',
  test: { method: 'GET', path: '/api/acquisition/connection' },
  capabilities: [{
    name: 'acquisition.get',
    class: 'read',
    description: 'Read signed-in visitors, new accounts, workspaces and saved-work counts. The connection fixes the campaign and visitor cohort. Customer acceptance and revenue remain unknown.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 90, description: 'Look back 1–90 days.' } },
      required: ['days'],
      additionalProperties: false,
    },
    request: { method: 'GET', path: '/api/acquisition/report', query: { days: '{days}' } },
  }],
})
