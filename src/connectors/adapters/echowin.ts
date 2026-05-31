import { declarativeRestConnector } from './declarative-rest.js'

export const echowinConnector = declarativeRestConnector({
  kind: 'echowin',
  displayName: 'Echowin',
  description: 'Manage contacts and workflows in Echowin.',
  auth: { kind: 'api-key', hint: 'Echowin API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.echowin.io/v1',
  test: { method: 'GET', path: '/contacts' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact in Echowin.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'First name of the contact.' },
          lastName: { type: 'string', description: 'Last name of the contact.' },
          email: { type: 'string', description: 'Email address of the contact.' },
          number: { type: 'string', description: 'Phone number (will be automatically cleaned).' },
          carrier: { type: 'string', description: 'Phone carrier name.' },
        },
        required: ['number'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          email: '{email}',
          number: '{number}',
          carrier: '{carrier}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Find a contact by name, email, or phone number.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name, email, or phone number.' },
        },
        required: ['search'],
      },
      request: {
        method: 'GET',
        path: '/contacts/search',
        query: { search: '{search}' },
      },
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact from Echowin.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'The unique identifier of the contact to delete.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}',
      },
    },
  ],
})
