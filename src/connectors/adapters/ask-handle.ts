import { declarativeRestConnector } from './declarative-rest.js'

export const askHandleConnector = declarativeRestConnector({
  kind: 'ask-handle',
  displayName: 'AskHandle',
  description: 'Manage leads, rooms, and messages with AskHandle.',
  auth: { kind: 'api-key', hint: 'AskHandle API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.askhandle.com/api',
  test: { method: 'GET', path: '/rooms' },
  capabilities: [
    {
      name: 'messages.create',
      class: 'mutation',
      description: 'Create a message in AskHandle.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          room_id: { type: 'string' },
        },
        required: ['body'],
      },
      request: { method: 'POST', path: '/messages', body: { body: '{body}', room_id: '{room_id}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create a lead in AskHandle.',
      parameters: {
        type: 'object',
        properties: {
          nickname: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          device: { type: 'string' },
          from_page_title: { type: 'string' },
          referrer: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/leads',
        body: {
          nickname: '{nickname}',
          email: '{email}',
          phone_number: '{phone_number}',
          device: '{device}',
          from_page_title: '{from_page_title}',
          referrer: '{referrer}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rooms.list',
      class: 'read',
      description: 'List rooms in AskHandle.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/rooms', query: { limit: '{limit}' } },
    },
    {
      name: 'leads.list',
      class: 'read',
      description: 'List leads in AskHandle.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          start_date: '{start_date}',
          end_date: '{end_date}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'messages.update',
      class: 'mutation',
      description: 'Update a draft AskHandle message.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Identifier of the message to update.' },
          body: { type: 'string', description: 'New message body.' },
        },
        required: ['message_id', 'body'],
      },
      request: {
        method: 'PATCH',
        path: '/messages/{message_id}',
        body: { body: '{body}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'messages.delete',
      class: 'mutation',
      description: 'Delete an AskHandle message.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Identifier of the message to delete.' },
        },
        required: ['message_id'],
      },
      request: {
        method: 'DELETE',
        path: '/messages/{message_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Patch attributes on an existing AskHandle lead.',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'Identifier of the lead to patch.' },
          nickname: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          device: { type: 'string' },
          from_page_title: { type: 'string' },
          referrer: { type: 'string' },
        },
        required: ['lead_id'],
      },
      request: {
        method: 'PATCH',
        path: '/leads/{lead_id}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'leads.delete',
      class: 'mutation',
      description: 'Delete an AskHandle lead.',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'Identifier of the lead to delete.' },
        },
        required: ['lead_id'],
      },
      request: {
        method: 'DELETE',
        path: '/leads/{lead_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
