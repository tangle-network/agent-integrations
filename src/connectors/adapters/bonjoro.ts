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
      name: 'greets.update',
      class: 'mutation',
      description: 'Update an existing Bonjoro greet (note, assignee, template, custom fields).',
      parameters: {
        type: 'object',
        properties: {
          greetId: { type: 'string', description: 'Bonjoro greet id to update.' },
          note: { type: 'string', description: 'Updated note for the greet.' },
          assignee: { type: 'string', description: 'Assignee user id.' },
          template: { type: 'string', description: 'Template id to use for the greet.' },
          campaign: { type: 'string', description: 'Campaign id the greet belongs to.' },
          custom: { type: 'object', description: 'Custom attributes attached to the greet.' },
        },
        required: ['greetId'],
      },
      request: {
        method: 'PATCH',
        path: '/greets/{greetId}',
        body: {
          note: '{note}',
          assignee: '{assignee}',
          template: '{template}',
          campaign: '{campaign}',
          custom: '{custom}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'greets.delete',
      class: 'mutation',
      description: 'Delete a Bonjoro greet by id.',
      parameters: {
        type: 'object',
        properties: {
          greetId: { type: 'string', description: 'Bonjoro greet id to delete.' },
        },
        required: ['greetId'],
      },
      request: { method: 'DELETE', path: '/greets/{greetId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create a new Bonjoro campaign.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name of the campaign.' },
          assignee: { type: 'string', description: 'Default assignee user id for greets in the campaign.' },
          template: { type: 'string', description: 'Default template id for greets in the campaign.' },
          description: { type: 'string', description: 'Optional campaign description.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/campaigns',
        body: {
          name: '{name}',
          assignee: '{assignee}',
          template: '{template}',
          description: '{description}',
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
