import { declarativeRestConnector } from './declarative-rest.js'

export const mixmaxConnector = declarativeRestConnector({
  kind: 'mixmax',
  displayName: 'Mixmax',
  description:
    'Email productivity automation for Gmail: manage Mixmax code snippets and contacts (create, find, list).',
  auth: { kind: 'api-key', hint: 'Mixmax API key, sent in the X-API-Token header.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.mixmax.com/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'create.code.snippet',
      class: 'mutation',
      description: 'Create a Mixmax code snippet with HTML content and optional syntax-highlighting metadata.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          html: { type: 'string' },
          language: { type: 'string' },
          background: { type: 'string' },
          theme: { type: 'string' },
        },
        required: ['html'],
      },
      request: {
        method: 'POST',
        path: '/codesnippets',
        body: {
          title: '{title}',
          html: '{html}',
          language: '{language}',
          background: '{background}',
          theme: '{theme}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'create.contact',
      class: 'mutation',
      description: 'Create a Mixmax contact by email, with optional name and third-party enrichment.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          enrich: { type: 'boolean' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{email}',
          name: '{name}',
          enrich: '{enrich}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'find.contact',
      class: 'read',
      description: 'Search Mixmax contacts by email or name, optionally including linked Salesforce contacts.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          includeSalesforceContacts: { type: 'boolean' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/contacts/search',
        query: {
          query: '{query}',
          includeSalesforceContacts: '{includeSalesforceContacts}',
        },
      },
    },
    {
      name: 'list.code.snippets',
      class: 'read',
      description: 'List Mixmax code snippets.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/codesnippets' },
    },
    {
      name: 'list.contacts',
      class: 'read',
      description: 'List Mixmax contacts with optional filter and sort.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          sort: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: {
          search: '{search}',
          sort: '{sort}',
        },
      },
    },
  ],
})
