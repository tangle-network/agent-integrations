import { declarativeRestConnector } from './declarative-rest.js'

export const loopsConnector = declarativeRestConnector({
  kind: 'loops',
  displayName: 'Loops',
  description: 'Send transactional and marketing emails. Manage contacts, trigger automations, and send campaigns.',
  auth: { kind: 'api-key', hint: 'Loops API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.loops.so/api/v1',
  test: { method: 'GET', path: '/contacts' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact or update an existing one.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the contact.' },
          firstName: { type: 'string', description: 'First name of the contact.' },
          lastName: { type: 'string', description: 'Last name of the contact.' },
          userId: { type: 'string', description: 'Internal user ID for this contact.' },
          subscribed: { type: 'boolean', description: 'Whether the contact is subscribed to marketing emails.' },
          userGroup: { type: 'string', description: 'Segment or group to assign the contact.' },
          source: { type: 'string', description: 'Source where this contact came from.' },
          customProperties: { type: 'object', description: 'Additional custom properties as key-value pairs.' },
        },
        required: ['email'],
      },
      request: { method: 'POST', path: '/contacts/create', body: '{.}' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Find a contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the contact to find.' },
        },
        required: ['email'],
      },
      request: { method: 'GET', path: '/contacts/find', query: { email: '{email}' } },
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the contact to delete.' },
        },
        required: ['email'],
      },
      request: { method: 'DELETE', path: '/contacts/delete', body: { email: '{email}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'events.send',
      class: 'mutation',
      description: 'Send an event to trigger automations or updates for a contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the contact.' },
          eventName: { type: 'string', description: 'Name of the event.' },
          properties: { type: 'object', description: 'Event properties as key-value pairs.' },
        },
        required: ['email', 'eventName'],
      },
      request: { method: 'POST', path: '/events/send', body: '{.}' },
      cas: 'native-idempotency',
    },
    {
      name: 'emails.sendTransactional',
      class: 'mutation',
      description: 'Send a transactional email to a contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the recipient.' },
          transactionalId: { type: 'string', description: 'ID of the transactional email template.' },
          dataVariables: { type: 'object', description: 'Template variables as key-value pairs.' },
        },
        required: ['email', 'transactionalId'],
      },
      request: { method: 'POST', path: '/transactional/send', body: '{.}' },
      cas: 'native-idempotency',
    },
  ],
})
