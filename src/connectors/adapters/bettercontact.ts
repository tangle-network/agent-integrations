import { declarativeRestConnector } from './declarative-rest.js'

// BetterContact — Waterfall email and phone enrichment that queries 20+ data providers to find a contact's work email and direct phone number.
// Auth: api-key. Base: https://app.bettercontact.rocks/api/v2. Docs: https://doc.bettercontact.rocks/api-reference/endpoint/create
export const bettercontactConnector = declarativeRestConnector({
  kind: 'bettercontact',
  displayName: 'BetterContact',
  description: 'Waterfall email and phone enrichment that queries 20+ data providers to find a contact\'s work email and direct phone number.',
  auth: {
    kind: 'api-key',
    hint: 'API key from the BetterContact dashboard (Settings -> API). Sent as the X-API-Key header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.bettercontact.rocks/api/v2',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'enrichment.create',
      class: 'mutation',
      description: 'Start an asynchronous waterfall enrichment for 1-100 contacts to find work emails and/or direct phone numbers. Consumes credits per found data point.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            description: 'Array of 1-100 lead objects to enrich; each supports first_name, last_name, company, company_domain, linkedin_url, and custom_fields.',
            items: { type: 'object' },
          },
          enrich_email_address: { type: 'boolean', description: 'If true, enrich the work email address.' },
          enrich_phone_number: { type: 'boolean', description: 'If true, enrich the direct phone number.' },
          webhook: {
            type: 'string',
            description: 'Optional URL to which results are pushed when enrichment completes.',
          },
        },
        required: ['data', 'enrich_email_address', 'enrich_phone_number'],
      },
      request: {
        method: 'POST',
        path: '/async',
        body: {
          data: '{data}',
          enrich_email_address: '{enrich_email_address}',
          enrich_phone_number: '{enrich_phone_number}',
          webhook: '{webhook}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'enrichment.get',
      class: 'read',
      description: 'Retrieve the status and enriched results of a previously submitted enrichment request by its request id.',
      parameters: {
        type: 'object',
        properties: {
          request_id: { type: 'string', description: 'The id returned by enrichment.create.' },
        },
        required: ['request_id'],
      },
      request: { method: 'GET', path: '/async/{request_id}' },
    },
  ],
})
