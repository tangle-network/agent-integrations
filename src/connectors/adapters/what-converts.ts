import { declarativeRestConnector } from './declarative-rest.js'

export const whatConvertsConnector = declarativeRestConnector({
  kind: 'what-converts',
  displayName: 'WhatConverts',
  description: 'Fetch, search, and manage leads in WhatConverts CRM.',
  auth: {
    kind: 'api-key',
    hint: 'WhatConverts API key.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.whatconverts.com/api/v1',
  test: { method: 'GET', path: '/leads' },
  capabilities: [
    {
      name: 'leads.list',
      class: 'read',
      description: 'List leads with optional filtering by date range, type, source, and other criteria.',
      parameters: {
        type: 'object',
        properties: {
          from_date: {
            type: 'string',
            description: 'Start date for the export range in YYYY-MM-DD format.',
          },
          to_date: {
            type: 'string',
            description: 'End date for the export range in YYYY-MM-DD format.',
          },
          lead_type: {
            type: 'string',
            description: 'Filter leads by their type.',
          },
          per_page: {
            type: 'integer',
            description: 'Number of leads to fetch per page (max 1000).',
          },
          no_of_pages: {
            type: 'integer',
            description: 'The number of pages to retrieve (max 100).',
          },
          referring_source: {
            type: 'string',
            description: 'Filter leads by source.',
          },
          referring_medium: {
            type: 'string',
            description: 'Filter leads by medium.',
          },
          referring_campaign: {
            type: 'string',
            description: 'Filter leads by campaign.',
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          from_date: '{from_date}',
          to_date: '{to_date}',
          lead_type: '{lead_type}',
          per_page: '{per_page}',
          no_of_pages: '{no_of_pages}',
          referring_source: '{referring_source}',
          referring_medium: '{referring_medium}',
          referring_campaign: '{referring_campaign}',
        },
      },
    },
    {
      name: 'leads.getByEmail',
      class: 'read',
      description: 'Retrieve a lead by email address.',
      parameters: {
        type: 'object',
        properties: {
          email_address: {
            type: 'string',
            description: 'Find a lead by their email address.',
          },
        },
        required: ['email_address'],
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          email: '{email_address}',
        },
      },
    },
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create a new lead in WhatConverts.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          company_name: { type: 'string' },
          notes: { type: 'string' },
          send_notification: {
            type: 'boolean',
            description: 'Set to true to send a new lead notification email.',
          },
          quote_value: {
            type: 'number',
            description: 'The monetary value of the quote associated with the lead.',
          },
          sales_value: {
            type: 'number',
            description: 'The monetary value of the sale associated with the lead.',
          },
          quotable: {
            type: 'string',
            description: 'Indicates if the lead is quotable.',
          },
        },
        required: ['first_name', 'last_name', 'email'],
      },
      request: {
        method: 'POST',
        path: '/leads',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          email: '{email}',
          phone_number: '{phone_number}',
          company_name: '{company_name}',
          notes: '{notes}',
          send_notification: '{send_notification}',
          quote_value: '{quote_value}',
          sales_value: '{sales_value}',
          quotable: '{quotable}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Update an existing lead in WhatConverts.',
      parameters: {
        type: 'object',
        properties: {
          lead_id: {
            type: 'string',
            description: 'The ID of the lead to update.',
          },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          company_name: { type: 'string' },
          notes: { type: 'string' },
          quote_value: {
            type: 'number',
            description: 'The monetary value of the quote associated with the lead.',
          },
          sales_value: {
            type: 'number',
            description: 'The monetary value of the sale associated with the lead.',
          },
          quotable: {
            type: 'string',
            description: 'Indicates if the lead is quotable.',
          },
        },
        required: ['lead_id'],
      },
      request: {
        method: 'PUT',
        path: '/leads/{lead_id}',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          email: '{email}',
          phone_number: '{phone_number}',
          company_name: '{company_name}',
          notes: '{notes}',
          quote_value: '{quote_value}',
          sales_value: '{sales_value}',
          quotable: '{quotable}',
        },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
