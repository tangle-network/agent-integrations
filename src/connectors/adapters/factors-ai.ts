import { declarativeRestConnector } from './declarative-rest.js'

// Factors.ai — B2B account intelligence and ABM platform. Retrieve the engagement journey (activity timeline) for a target account by domain.
// Auth: api-key. Base: https://api.factors.ai/open/v1. Docs: https://help.factors.ai/en/articles/11028633-account-journey-api
export const factorsAiConnector = declarativeRestConnector({
  kind: 'factors-ai',
  displayName: 'Factors.ai',
  description: 'B2B account intelligence and ABM platform. Retrieve the engagement journey (activity timeline) for a target account by domain.',
  auth: {
    kind: 'api-key',
    hint: 'Generate a private API token for the target project in Factors.ai. Sent as the Authorization: Bearer header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.factors.ai/open/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/account/factors.ai/journey' },
  capabilities: [
    {
      name: 'account.journey',
      class: 'read',
      description: 'Get the account journey (chronological engagement events) for a given account domain, optionally filtered by date range, event name, or user.',
      parameters: {
        type: 'object',
        properties: {
          account_domain: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          event_name: { type: 'string' },
          user_name: { type: 'string' },
        },
        required: ['account_domain'],
      },
      request: {
        method: 'GET',
        path: '/account/{account_domain}/journey',
        query: {
          from: '{from}',
          to: '{to}',
          event_name: '{event_name}',
          user_name: '{user_name}',
        },
      },
    },
  ],
})
