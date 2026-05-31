import { declarativeRestConnector } from './declarative-rest.js'

export const bonjoroConnector = declarativeRestConnector({
  kind: 'bonjoro',
  displayName: 'Bonjoro',
  description: 'Send personal video greeting messages to delight customers via Bonjoro.',
  auth: { kind: 'api-key', hint: 'Bonjoro account API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.bonjoro.com/api/v2',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'greets.add',
      class: 'mutation',
      description:
        'Create a new Bonjoro greet for a customer, optionally tied to an assignee, campaign, or template.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email of the recipient to greet.' },
          note: { type: 'string', description: 'Note to send with the greet.' },
          first: { type: 'string', description: 'Recipient first name.' },
          last: { type: 'string', description: 'Recipient last name.' },
          assignee: { type: 'string', description: 'Assignee user id.' },
          campaign: { type: 'string', description: 'Campaign id to attach the greet to.' },
          template: { type: 'string', description: 'Template id to use for the greet.' },
          custom: { type: 'object', description: 'Custom attributes attached to the greet.' },
        },
        required: ['email', 'note'],
      },
      request: {
        method: 'POST',
        path: '/greets',
        body: {
          email: '{email}',
          note: '{note}',
          first: '{first}',
          last: '{last}',
          assignee: '{assignee}',
          campaign: '{campaign}',
          template: '{template}',
          custom: '{custom}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assignees.list',
      class: 'read',
      description: 'List Bonjoro account members eligible to be assigned a greet.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/assignees' },
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List Bonjoro campaigns available on the account.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/campaigns' },
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List greet templates available on the Bonjoro account.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/templates' },
    },
  ],
})
