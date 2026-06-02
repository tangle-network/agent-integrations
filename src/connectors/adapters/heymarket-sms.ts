import { declarativeRestConnector } from './declarative-rest.js'

export const heymarketSmsConnector = declarativeRestConnector({
  kind: 'heymarket-sms',
  displayName: 'Heymarket SMS',
  description:
    'Heymarket business texting: create or update contacts, send custom and template messages, update lists.',
  auth: {
    kind: 'api-key',
    hint: 'Heymarket private API token, sent as Bearer in the Authorization header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.heymarket.com/v3',
  test: { method: 'GET', path: '/inboxes' },
  capabilities: [
    {
      name: 'contacts.createOrUpdate',
      class: 'mutation',
      description:
        'Create a new Heymarket contact or update an existing one keyed by phone number (or contact_id when supplied).',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          first: { type: 'string' },
          last: { type: 'string' },
          display_name: { type: 'string' },
          email: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          is_opted_out: { type: 'boolean' },
          contact_id: { type: 'string' },
          overwrite: { type: 'boolean' },
        },
        required: ['phone'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          phone: '{phone}',
          first: '{first}',
          last: '{last}',
          display_name: '{display_name}',
          email: '{email}',
          tags: '{tags}',
          is_opted_out: '{is_opted_out}',
          contact_id: '{contact_id}',
          overwrite: '{overwrite}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'messages.sendCustom',
      class: 'mutation',
      description:
        'Send a custom SMS/MMS message from a Heymarket inbox to a phone number or group of targets.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'integer' },
          creator_id: { type: 'integer' },
          text: { type: 'string' },
          phone_number: { type: 'string' },
          targets: { type: 'array', items: { type: 'string' } },
        },
        required: ['inbox_id', 'creator_id', 'text'],
      },
      request: {
        method: 'POST',
        path: '/messages/send',
        body: {
          inbox_id: '{inbox_id}',
          creator_id: '{creator_id}',
          text: '{text}',
          phone_number: '{phone_number}',
          targets: '{targets}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'messages.sendTemplate',
      class: 'mutation',
      description:
        'Send a templated Heymarket message identified by template_id from the given inbox.',
      parameters: {
        type: 'object',
        properties: {
          inbox_id: { type: 'integer' },
          creator_id: { type: 'integer' },
          template_id: { type: 'integer' },
          phone_number: { type: 'string' },
          targets: { type: 'array', items: { type: 'string' } },
        },
        required: ['inbox_id', 'creator_id', 'template_id'],
      },
      request: {
        method: 'POST',
        path: '/messages/send/template',
        body: {
          inbox_id: '{inbox_id}',
          creator_id: '{creator_id}',
          template_id: '{template_id}',
          phone_number: '{phone_number}',
          targets: '{targets}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.update',
      class: 'mutation',
      description:
        'Rename a Heymarket list and add/remove member phone numbers. Risk-classed as read by the upstream piece but mutates list membership.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'integer' },
          title: { type: 'string' },
          add_phone: { type: 'string' },
          remove_phone: { type: 'string' },
          members: { type: 'object' },
        },
        required: ['list_id', 'title'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{list_id}',
        body: {
          title: '{title}',
          add_phone: '{add_phone}',
          remove_phone: '{remove_phone}',
          members: '{members}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description:
        'Delete a Heymarket contact by contact_id. Heymarket returns 200 on first delete, 404 on subsequent calls.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string', description: 'The Heymarket contact identifier to delete.' },
        },
        required: ['contact_id'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contact_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
