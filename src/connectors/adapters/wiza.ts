import { declarativeRestConnector } from './declarative-rest.js'

// Wiza — Real-time contact enrichment that reveals a person's work/personal email and phone from a LinkedIn URL, email, or name plus company.
// Auth: api-key. Base: https://wiza.co/api. Docs: https://docs.wiza.co/api-reference/individual-reveals/start-individual-reveal
export const wizaConnector = declarativeRestConnector({
  kind: 'wiza',
  displayName: 'Wiza',
  description: 'Real-time contact enrichment that reveals a person\'s work/personal email and phone from a LinkedIn URL, email, or name plus company.',
  auth: {
    kind: 'api-key',
    hint: 'API key from Wiza account settings. Sent as the Authorization: Bearer header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://wiza.co/api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/meta/credits' },
  capabilities: [
    {
      name: 'individual_reveal.create',
      class: 'mutation',
      description: 'Start a real-time individual reveal to enrich one contact\'s email and phone from a LinkedIn URL, email, or name plus company/domain. Consumes credits.',
      parameters: {
        type: 'object',
        properties: {
          individual_reveal: {
            type: 'object',
            description: 'Contact identifiers: full_name + company or domain, OR email, OR linkedin (profile URL).',
          },
          enrichment_level: { type: 'string', description: 'One of none, partial, phone, or full.' },
          email_options: {
            type: 'object',
            description: 'Object with accept_work and accept_personal booleans.',
          },
          phone_options: { type: 'object', description: 'Phone enrichment options.' },
        },
        required: ['individual_reveal', 'enrichment_level'],
      },
      request: {
        method: 'POST',
        path: '/individual_reveals',
        body: {
          individual_reveal: '{individual_reveal}',
          enrichment_level: '{enrichment_level}',
          email_options: '{email_options}',
          phone_options: '{phone_options}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'individual_reveal.get',
      class: 'read',
      description: 'Retrieve the status and revealed contact data of an individual reveal by its id.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The individual reveal id returned by individual_reveal.create.',
          },
        },
        required: ['id'],
      },
      request: { method: 'GET', path: '/individual_reveals/{id}' },
    },
    {
      name: 'list.create',
      class: 'mutation',
      description: 'Create a list to enrich up to 2500 profiles in bulk with email and phone data. Consumes credits.',
      parameters: {
        type: 'object',
        properties: {
          list: {
            type: 'object',
            description: 'List config including name, enrichment_level, email_options, and items (array of up to 2500 profiles).',
          },
        },
        required: ['list'],
      },
      request: { method: 'POST', path: '/lists', body: { list: '{list}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'credits.get',
      class: 'read',
      description: 'Get the account\'s remaining email, phone, export, and API credit balances.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/meta/credits' },
    },
  ],
})
