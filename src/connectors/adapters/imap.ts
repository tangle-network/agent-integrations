import { declarativeRestConnector } from './declarative-rest.js'

export const imapConnector = declarativeRestConnector({
  kind: 'imap',
  displayName: 'IMAP',
  description: 'Receive new email via IMAP, mark emails as read, copy, move, or delete emails.',
  auth: {
    kind: 'api-key',
    hint: 'IMAP server credentials (host, username, password, port, TLS settings).',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'imap://{host}:{port}',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'emails.mark-as-read',
      class: 'mutation',
      description: 'Mark an email as read.',
      parameters: {
        type: 'object',
        properties: {
          mailbox: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['mailbox', 'messageId'],
      },
      request: {
        method: 'POST',
        path: '/{mailbox}/{messageId}/mark-read',
      },
    },
    {
      name: 'emails.copy',
      class: 'mutation',
      description: 'Copy an email to another mailbox.',
      parameters: {
        type: 'object',
        properties: {
          mailbox: { type: 'string' },
          messageId: { type: 'string' },
          targetMailbox: { type: 'string' },
        },
        required: ['mailbox', 'messageId', 'targetMailbox'],
      },
      request: {
        method: 'POST',
        path: '/{mailbox}/{messageId}/copy',
        body: { targetMailbox: '{targetMailbox}' },
      },
    },
    {
      name: 'emails.move',
      class: 'mutation',
      description: 'Move an email to another mailbox.',
      parameters: {
        type: 'object',
        properties: {
          mailbox: { type: 'string' },
          messageId: { type: 'string' },
          targetMailbox: { type: 'string' },
        },
        required: ['mailbox', 'messageId', 'targetMailbox'],
      },
      request: {
        method: 'POST',
        path: '/{mailbox}/{messageId}/move',
        body: { targetMailbox: '{targetMailbox}' },
      },
    },
    {
      name: 'emails.delete',
      class: 'mutation',
      description: 'Delete an email permanently.',
      parameters: {
        type: 'object',
        properties: {
          mailbox: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['mailbox', 'messageId'],
      },
      request: {
        method: 'POST',
        path: '/{mailbox}/{messageId}/delete',
      },
    },
    {
      name: 'folders.create',
      class: 'mutation',
      description: 'Create a new IMAP folder (mailbox).',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'IMAP folder name to create (e.g. INBOX/Archive).',
          },
        },
        required: ['folder'],
      },
      request: {
        method: 'POST',
        path: '/folders',
        body: { folder: '{folder}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
