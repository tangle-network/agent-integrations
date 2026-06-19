import { declarativeRestConnector } from './declarative-rest.js'

// FullEnrich — Waterfall B2B contact enrichment API that finds work emails and phone numbers for a contact from name, company, or LinkedIn URL.
// Auth: api-key. Base: https://app.fullenrich.com/api/v2. Docs: https://docs.fullenrich.com/
export const fullenrichConnector = declarativeRestConnector({
  kind: 'fullenrich',
  displayName: 'FullEnrich',
  description: 'Waterfall B2B contact enrichment API that finds work emails and phone numbers for a contact from name, company, or LinkedIn URL.',
  auth: {
    kind: 'api-key',
    hint: 'API key from the FullEnrich dashboard (app.fullenrich.com/app/api). Sent as the Authorization: Bearer header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.fullenrich.com/api/v2',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/account/credits' },
  capabilities: [
    {
      name: 'account.credits',
      class: 'read',
      description: 'Return the current credit balance for the account.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/account/credits' },
    },
    {
      name: 'contact.enrich.start',
      class: 'mutation',
      description: 'Start an async waterfall enrichment for up to 100 contacts; returns an enrichment id and bills per found data point.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                domain: { type: 'string' },
                company_name: { type: 'string' },
                linkedin_url: { type: 'string' },
                enrich_fields: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          webhook_url: { type: 'string' },
        },
        required: ['name', 'data'],
      },
      request: {
        method: 'POST',
        path: '/contact/enrich/bulk',
        body: { name: '{name}', data: '{data}', webhook_url: '{webhook_url}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'contact.enrich.result',
      class: 'read',
      description: 'Retrieve the result of a previously started bulk enrichment by its id.',
      parameters: {
        type: 'object',
        properties: { enrichment_id: { type: 'string' } },
        required: ['enrichment_id'],
      },
      request: { method: 'GET', path: '/contact/enrich/bulk/{enrichment_id}' },
    },
    {
      name: 'contact.reverse_email.start',
      class: 'mutation',
      description: 'Start an async reverse-email lookup to find profiles/identities behind email addresses.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          data: {
            type: 'array',
            items: { type: 'object', properties: { email: { type: 'string' } } },
          },
          webhook_url: { type: 'string' },
        },
        required: ['name', 'data'],
      },
      request: {
        method: 'POST',
        path: '/contact/reverse/email/bulk',
        body: { name: '{name}', data: '{data}', webhook_url: '{webhook_url}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
