import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Chatwoot — open-source customer engagement platform.
 *
 * Auth: per-user API access token (Profile Settings → API Access Token),
 * sent as the `api_access_token` header on every request. The instance
 * URL is configurable because Chatwoot is self-hostable; the cloud-hosted
 * default is `https://app.chatwoot.com`.
 *
 * Surface covered:
 * - send.message (mirrors the upstream `sendMessage` action — POST a
 *   message into an existing conversation, optionally as a private note)
 * - toggle_status (open / resolve / re-open / mark pending an existing
 *   conversation via the upstream `toggle_status` action)
 * - assign_conversation (assign or unassign a conversation to a teammate
 *   via the upstream `assignments` action)
 */
export const chatwootConnector = declarativeRestConnector({
  kind: 'chatwoot',
  displayName: 'Chatwoot',
  description: 'Receive and reply to customer messages with Chatwoot.',
  auth: {
    kind: 'api-key',
    hint: 'Chatwoot user API access token (Profile Settings → API Access Token). Sent as the `api_access_token` header.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  // Chatwoot is self-hostable, so the base URL is per-DataSource. The
  // cloud-hosted default is offered as a fallback.
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://app.chatwoot.com' },
  credentialPlacement: { kind: 'header', header: 'api_access_token' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'GET', path: '/api/v1/profile' },
  capabilities: [
    {
      name: 'send.message',
      class: 'mutation',
      description:
        'Send a message (or private note) into an existing Chatwoot conversation.',
      parameters: {
        type: 'object',
        properties: {
          accountId: {
            type: 'number',
            description:
              'Numeric Chatwoot account ID (visible in the dashboard URL).',
          },
          conversationId: {
            type: 'number',
            description: 'Numeric conversation display ID.',
          },
          content: {
            type: 'string',
            description: 'Text message body to send.',
          },
          private: {
            type: 'boolean',
            description:
              'If true, posts as a private note visible only to agents, not to the contact.',
          },
          message_type: {
            type: 'string',
            enum: ['outgoing', 'incoming'],
            description:
              'Direction of the message. Defaults to `outgoing` (agent → contact).',
          },
        },
        required: ['accountId', 'conversationId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/accounts/{accountId}/conversations/{conversationId}/messages',
        body: {
          content: '{content}',
          message_type: '{message_type}',
          private: '{private}',
        },
      },
      // Chatwoot's message endpoint does not expose a server-side idempotency
      // key, so a retried POST will create a duplicate message. Callers must
      // dedupe before invoking.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'toggle_status',
      class: 'mutation',
      description:
        'Toggle the status of an existing Chatwoot conversation (open, resolved, or pending).',
      parameters: {
        type: 'object',
        properties: {
          account_id: {
            type: 'number',
            description:
              'Numeric Chatwoot account ID (visible in the dashboard URL).',
          },
          conversation_id: {
            type: 'number',
            description: 'Numeric conversation display ID.',
          },
          status: {
            type: 'string',
            enum: ['open', 'resolved', 'pending'],
            description: 'New conversation status to apply.',
          },
        },
        required: ['account_id', 'conversation_id', 'status'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_status',
        body: {
          status: '{status}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assign_conversation',
      class: 'mutation',
      description:
        'Assign (or reassign) an existing Chatwoot conversation to a teammate by user id.',
      parameters: {
        type: 'object',
        properties: {
          account_id: {
            type: 'number',
            description:
              'Numeric Chatwoot account ID (visible in the dashboard URL).',
          },
          conversation_id: {
            type: 'number',
            description: 'Numeric conversation display ID.',
          },
          assignee_id: {
            type: 'number',
            description:
              'Numeric user id of the Chatwoot teammate to assign the conversation to.',
          },
        },
        required: ['account_id', 'conversation_id', 'assignee_id'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/accounts/{account_id}/conversations/{conversation_id}/assignments',
        body: {
          assignee_id: '{assignee_id}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
