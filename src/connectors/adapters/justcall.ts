import { declarativeRestConnector } from './declarative-rest.js'

// JustCall — Cloud phone system and SMS platform. Place and list calls, manage contacts, and send SMS/MMS programmatically.
// Auth: api-key. Base: https://api.justcall.io/v2.1. Docs: https://developer.justcall.io/reference/authentication
export const justcallConnector = declarativeRestConnector({
  kind: 'justcall',
  displayName: 'JustCall',
  description: 'Cloud phone system and SMS platform. Place and list calls, manage contacts, and send SMS/MMS programmatically.',
  auth: {
    kind: 'api-key',
    hint: 'Get your API Key and API Secret from JustCall Settings -> Developers. Paste them joined by a colon as "api_key:api_secret"; sent as the Authorization header.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.justcall.io/v2.1',
  credentialPlacement: { kind: 'header', header: 'Authorization' },
  defaultHeaders: { 'content-type': 'application/json', accept: 'application/json' },
  test: { method: 'GET', path: '/calls', query: { per_page: '1' } },
  capabilities: [
    {
      name: 'calls.list',
      class: 'read',
      description: 'List call records linked to the account, with optional filters for number, direction, type, and date range.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          per_page: { type: 'integer' },
          contact_number: { type: 'string' },
          from_datetime: { type: 'string' },
          to_datetime: { type: 'string' },
          call_direction: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/calls',
        query: {
          page: '{page}',
          per_page: '{per_page}',
          contact_number: '{contact_number}',
          from_datetime: '{from_datetime}',
          to_datetime: '{to_datetime}',
          call_direction: '{call_direction}',
        },
      },
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Get a single Sales Dialer call by its unique call id.',
      parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      request: { method: 'GET', path: '/sales_dialer/calls/{id}' },
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts in the account, optionally filtered by name or number.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          per_page: { type: 'integer' },
          contact_number: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          across_team: { type: 'boolean' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: {
          page: '{page}',
          per_page: '{per_page}',
          contact_number: '{contact_number}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          across_team: '{across_team}',
        },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact in Sales Dialer.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone_number: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'phone_number'],
      },
      request: {
        method: 'POST',
        path: '/sales_dialer/contacts',
        body: { name: '{name}', phone_number: '{phone_number}', email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description: 'Send an SMS or MMS from a JustCall number to a contact number.',
      parameters: {
        type: 'object',
        properties: {
          justcall_number: { type: 'string' },
          contact_number: { type: 'string' },
          body: { type: 'string' },
          media_url: { type: 'string' },
        },
        required: ['justcall_number', 'contact_number', 'body'],
      },
      request: {
        method: 'POST',
        path: '/texts/new',
        body: {
          justcall_number: '{justcall_number}',
          contact_number: '{contact_number}',
          body: '{body}',
          media_url: '{media_url}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
