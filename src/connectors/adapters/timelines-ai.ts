import { declarativeRestConnector } from './declarative-rest.js'

export const timelinesAiConnector = declarativeRestConnector({
  kind: 'timelines-ai',
  displayName: 'Timelines AI',
  description: 'Search, manage, and send WhatsApp messages through Timelines AI.',
  auth: { kind: 'api-key', hint: 'Timelines AI API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.timelines.ai',
  test: { method: 'GET', path: '/v1/accounts' },
  capabilities: [
    {
      name: 'chats.find',
      class: 'read',
      description: 'Find chats with optional filters (name, labels, responsible, read status, closed status, ChatGPT autoresponse status, creation date).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          label: { type: 'object' },
          responsible: { type: 'object' },
          read: { type: 'boolean' },
          closed: { type: 'boolean' },
          chatgpt_autoresponse_enabled: { type: 'boolean' },
          created_after: { type: 'string' },
          created_before: { type: 'string' },
          page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/chats',
        query: {
          name: '{name}',
          label: '{label}',
          responsible: '{responsible}',
          read: '{read}',
          closed: '{closed}',
          chatgpt_autoresponse_enabled: '{chatgpt_autoresponse_enabled}',
          created_after: '{created_after}',
          created_before: '{created_before}',
          page: '{page}',
        },
      },
    },
    {
      name: 'messages.find',
      class: 'read',
      description: 'Find a specific message by message UID.',
      parameters: {
        type: 'object',
        properties: {
          message_uid: { type: 'string' },
        },
        required: ['message_uid'],
      },
      request: {
        method: 'GET',
        path: '/v1/messages/{message_uid}',
      },
    },
    {
      name: 'messages.status',
      class: 'read',
      description: 'Find the status of a message.',
      parameters: {
        type: 'object',
        properties: {
          message_uid: { type: 'string' },
        },
        required: ['message_uid'],
      },
      request: {
        method: 'GET',
        path: '/v1/messages/{message_uid}/status',
      },
    },
    {
      name: 'files.find',
      class: 'read',
      description: 'Find an uploaded file by filename.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
        },
        required: ['filename'],
      },
      request: {
        method: 'GET',
        path: '/v1/files',
        query: {
          filename: '{filename}',
        },
      },
    },
    {
      name: 'accounts.find',
      class: 'read',
      description: 'Find a WhatsApp account by ID or phone number.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          phone: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/accounts',
        query: {
          id: '{id}',
          phone: '{phone}',
        },
      },
    },
    {
      name: 'chats.close',
      class: 'mutation',
      description: 'Close a chat.',
      parameters: {
        type: 'object',
        properties: {
          jid: { type: 'string' },
        },
        required: ['jid'],
      },
      request: {
        method: 'POST',
        path: '/v1/chats/{jid}/close',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a message to an existing chat.',
      parameters: {
        type: 'object',
        properties: {
          jid: { type: 'string' },
          text: { type: 'string' },
          attachment_template_id: { type: 'integer' },
        },
        required: ['jid', 'text'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages/send',
        body: {
          jid: '{jid}',
          text: '{text}',
          attachment_template_id: '{attachment_template_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.send.to.new.chat',
      class: 'mutation',
      description: 'Send a message to a new chat.',
      parameters: {
        type: 'object',
        properties: {
          contactType: { type: 'string' },
          contact: { type: 'string' },
          chat_name: { type: 'string' },
          text: { type: 'string' },
          attachment_template_id: { type: 'integer' },
        },
        required: ['contactType', 'contact', 'text'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages/send-to-new-chat',
        body: {
          contactType: '{contactType}',
          contact: '{contact}',
          chat_name: '{chat_name}',
          text: '{text}',
          attachment_template_id: '{attachment_template_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'files.send',
      class: 'mutation',
      description: 'Send a file to an existing chat.',
      parameters: {
        type: 'object',
        properties: {
          jid: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['jid', 'file'],
      },
      request: {
        method: 'POST',
        path: '/v1/files/send',
        body: {
          jid: '{jid}',
          file: '{file}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'files.send.uploaded',
      class: 'mutation',
      description: 'Send an uploaded file to an existing chat.',
      parameters: {
        type: 'object',
        properties: {
          jid: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['jid', 'file'],
      },
      request: {
        method: 'POST',
        path: '/v1/files/send-uploaded',
        body: {
          jid: '{jid}',
          file: '{file}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
