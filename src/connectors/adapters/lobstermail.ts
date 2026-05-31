import { declarativeRestConnector } from './declarative-rest.js'

/**
 * LobsterMail adapter — managed inbox + transactional email API at
 * https://lobstermail.ai. Auth is a bearer API key minted from
 * Settings → API Keys; the key is forwarded as `Authorization: Bearer <key>`
 * on every call, which is `declarativeRestConnector`'s default placement.
 *
 * Capabilities mirror the activepieces catalog's `lobstermail` entry:
 * inbox lifecycle (create / get / list / delete), outbound email send,
 * and inbound email read paths (list / get / search) plus the account
 * lookup used by the SDK as a credential health check.
 */
export const lobstermailConnector = declarativeRestConnector({
  kind: 'lobstermail',
  displayName: 'LobsterMail',
  description: 'Provision LobsterMail inboxes, send transactional email, and search received messages.',
  auth: { kind: 'api-key', hint: 'LobsterMail API key from Settings → API Keys (starts with lm_).' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lobstermail.ai/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Fetch the LobsterMail account associated with the current API key.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/account' },
    },
    {
      name: 'inboxes.create',
      class: 'mutation',
      description: 'Create a new inbox under the account. Domain defaults to lobstermail.ai when omitted.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          localPart: { type: 'string' },
          domain: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/inboxes',
        body: {
          display_name: '{displayName}',
          local_part: '{localPart}',
          domain: '{domain}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'inboxes.get',
      class: 'read',
      description: 'Fetch a single inbox by ID.',
      parameters: {
        type: 'object',
        properties: { inboxId: { type: 'string' } },
        required: ['inboxId'],
      },
      request: { method: 'GET', path: '/inboxes/{inboxId}' },
    },
    {
      name: 'inboxes.list',
      class: 'read',
      description: 'List inboxes on the account.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' } },
      },
      request: {
        method: 'GET',
        path: '/inboxes',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'inboxes.delete',
      class: 'mutation',
      description: 'Permanently delete an inbox and detach its email address.',
      parameters: {
        type: 'object',
        properties: { inboxId: { type: 'string' } },
        required: ['inboxId'],
      },
      request: { method: 'DELETE', path: '/inboxes/{inboxId}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'emails.send',
      class: 'mutation',
      description:
        'Send a transactional email from an inbox. At least one of body_text or body_html is required by the API.',
      parameters: {
        type: 'object',
        properties: {
          inboxId: { type: 'string' },
          to: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body_text: { type: 'string' },
          body_html: { type: 'string' },
          cc: { type: 'array', items: { type: 'string' } },
          in_reply_to: { type: 'string' },
          thread_id: { type: 'string' },
        },
        required: ['inboxId', 'to', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/inboxes/{inboxId}/emails',
        body: {
          to: '{to}',
          subject: '{subject}',
          body_text: '{body_text}',
          body_html: '{body_html}',
          cc: '{cc}',
          in_reply_to: '{in_reply_to}',
          thread_id: '{thread_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'emails.list',
      class: 'read',
      description: 'List emails on an inbox, optionally filtered by direction, unread state, or attachment presence.',
      parameters: {
        type: 'object',
        properties: {
          inboxId: { type: 'string' },
          direction: { type: 'string', enum: ['inbound', 'outbound'] },
          unread_only: { type: 'boolean' },
          has_attachments: { type: 'boolean' },
          limit: { type: 'integer' },
        },
        required: ['inboxId'],
      },
      request: {
        method: 'GET',
        path: '/inboxes/{inboxId}/emails',
        query: {
          direction: '{direction}',
          unread_only: '{unread_only}',
          has_attachments: '{has_attachments}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'emails.get',
      class: 'read',
      description: 'Fetch a single email by ID (prefix eml_), including full body and attachment metadata.',
      parameters: {
        type: 'object',
        properties: { email_id: { type: 'string' } },
        required: ['email_id'],
      },
      request: { method: 'GET', path: '/emails/{email_id}' },
    },
    {
      name: 'emails.search',
      class: 'read',
      description:
        'Search emails across the account. Searches subjects (highest priority), senders, and body previews; optionally narrowed by sender or attachment presence.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          from: { type: 'string' },
          has_attachments: { type: 'boolean' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/emails/search',
        query: {
          q: '{query}',
          from: '{from}',
          has_attachments: '{has_attachments}',
          limit: '{limit}',
        },
      },
    },
  ],
})
