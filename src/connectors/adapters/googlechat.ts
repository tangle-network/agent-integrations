import { declarativeRestConnector } from './declarative-rest.js'

const SCOPE_MESSAGES = 'https://www.googleapis.com/auth/chat.messages'
const SCOPE_SPACES = 'https://www.googleapis.com/auth/chat.spaces'
const SCOPE_MEMBERSHIPS = 'https://www.googleapis.com/auth/chat.memberships'
const SCOPE_MESSAGES_READONLY = 'https://www.googleapis.com/auth/chat.messages.readonly'

export const googlechatConnector = declarativeRestConnector({
  kind: 'googlechat',
  displayName: 'Google Chat',
  description:
    'Send messages to Google Chat spaces and direct messages, fetch message details, add members to spaces, list/search messages, and locate space members.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [SCOPE_MESSAGES, SCOPE_SPACES, SCOPE_MEMBERSHIPS, SCOPE_MESSAGES_READONLY],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://chat.googleapis.com/v1',
  test: { method: 'GET', path: '/spaces', query: { pageSize: 1 } },
  capabilities: [
    {
      name: 'send.amessage',
      class: 'mutation',
      description:
        'Send a message to a Google Chat space or DM. Pass the parent space (e.g. "spaces/AAAA1234") and a Chat message payload (text or cardsV2).',
      parameters: {
        type: 'object',
        properties: {
          space: { type: 'string', description: 'Space resource name, e.g. "spaces/AAAA1234".' },
          message: {
            type: 'object',
            description: 'A Chat Message resource. Most callers set { text } or { cardsV2 }.',
          },
          threadKey: {
            type: 'string',
            description: 'Optional thread key for grouping replies under a synthetic thread.',
          },
          messageReplyOption: {
            type: 'string',
            enum: [
              'MESSAGE_REPLY_OPTION_UNSPECIFIED',
              'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
              'REPLY_MESSAGE_OR_FAIL',
            ],
            description: 'Controls thread reply behavior when message.thread is set.',
          },
        },
        required: ['space', 'message'],
      },
      request: {
        method: 'POST',
        path: '/{space}/messages',
        query: {
          threadKey: '{threadKey}',
          messageReplyOption: '{messageReplyOption}',
        },
        body: '{message}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: [SCOPE_MESSAGES],
    },
    {
      name: 'get.direct.message.details',
      class: 'read',
      description:
        'Read a direct message by resource name. Direct messages live under the DM space ("spaces/{dmId}/messages/{messageId}").',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Full message resource name, e.g. "spaces/AAAA/messages/BBBB".',
          },
        },
        required: ['name'],
      },
      request: { method: 'GET', path: '/{name}' },
      requiredScopes: [SCOPE_MESSAGES_READONLY],
    },
    {
      name: 'add.aspace.member',
      class: 'mutation',
      description:
        'Add a human user or Chat app as a member to a space. Provide the parent space and a Membership resource (member.name = "users/{userId}").',
      parameters: {
        type: 'object',
        properties: {
          space: { type: 'string', description: 'Parent space resource name, e.g. "spaces/AAAA1234".' },
          membership: {
            type: 'object',
            description:
              'Membership resource. Typically { member: { name: "users/123", type: "HUMAN" } } or { groupMember: { name: "groups/xyz" } }.',
          },
        },
        required: ['space', 'membership'],
      },
      request: {
        method: 'POST',
        path: '/{space}/members',
        body: '{membership}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: [SCOPE_MEMBERSHIPS],
    },
    {
      name: 'get.message.details',
      class: 'read',
      description:
        'Read a Chat message by full resource name ("spaces/{space}/messages/{message}"). Returns the Message resource including text, sender, thread, and any cardsV2 payload.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Full message resource name, e.g. "spaces/AAAA/messages/BBBB".',
          },
        },
        required: ['name'],
      },
      request: { method: 'GET', path: '/{name}' },
      requiredScopes: [SCOPE_MESSAGES_READONLY],
    },
    {
      name: 'search.messages',
      class: 'read',
      description:
        'List messages in a space, optionally filtered with the Chat API filter syntax (e.g. "createTime > \\"2024-01-01T00:00:00Z\\"") and ordered by createTime.',
      parameters: {
        type: 'object',
        properties: {
          space: { type: 'string', description: 'Parent space resource name, e.g. "spaces/AAAA1234".' },
          filter: { type: 'string', description: 'Chat API list filter expression.' },
          orderBy: { type: 'string', description: 'e.g. "createTime desc".' },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
          showDeleted: { type: 'boolean' },
        },
        required: ['space'],
      },
      request: {
        method: 'GET',
        path: '/{space}/messages',
        query: {
          filter: '{filter}',
          orderBy: '{orderBy}',
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          showDeleted: '{showDeleted}',
        },
      },
      requiredScopes: [SCOPE_MESSAGES_READONLY],
    },
    {
      name: 'find.member',
      class: 'read',
      description:
        'List or filter memberships of a space to locate a specific user, group, or app. Use filter (e.g. "member.type = \\"HUMAN\\"") to narrow results.',
      parameters: {
        type: 'object',
        properties: {
          space: { type: 'string', description: 'Parent space resource name, e.g. "spaces/AAAA1234".' },
          filter: { type: 'string', description: 'Chat API membership filter expression.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
          showGroups: { type: 'boolean' },
          showInvited: { type: 'boolean' },
        },
        required: ['space'],
      },
      request: {
        method: 'GET',
        path: '/{space}/members',
        query: {
          filter: '{filter}',
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          showGroups: '{showGroups}',
          showInvited: '{showInvited}',
        },
      },
      requiredScopes: [SCOPE_MEMBERSHIPS],
    },
    {
      name: 'message.update',
      class: 'mutation',
      description:
        'Edit a previously sent message in a Google Chat space. Pass the full message resource name and an updateMask listing the fields being modified (e.g. "text" or "cardsV2"). Body is the partial Message resource holding the new values.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Full message resource name, e.g. "spaces/AAAA/messages/BBBB".',
          },
          updateMask: {
            type: 'string',
            description: 'Comma-separated list of fields to update, e.g. "text" or "cardsV2,attachment".',
          },
          message: {
            type: 'object',
            description: 'Partial Message resource carrying the new field values referenced by updateMask.',
          },
        },
        required: ['name', 'updateMask', 'message'],
      },
      request: {
        method: 'PATCH',
        path: '/{name}',
        query: { updateMask: '{updateMask}' },
        body: '{message}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: [SCOPE_MESSAGES],
    },
    {
      name: 'message.delete',
      class: 'mutation',
      description:
        'Delete a message from a Google Chat space. Only the authenticated user\'s own messages can be deleted with user-token credentials; Chat apps can delete their own messages.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Full message resource name, e.g. "spaces/AAAA/messages/BBBB".',
          },
          force: {
            type: 'boolean',
            description: 'When true, also delete threaded replies; defaults to false.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'DELETE',
        path: '/{name}',
        query: { force: '{force}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: [SCOPE_MESSAGES],
    },
    {
      name: 'space.create',
      class: 'mutation',
      description:
        'Create a named Google Chat space. Pass a Space resource with displayName and spaceType (e.g. "SPACE" for a named group space). For DM creation use spaces.setup; this capability covers the spaces.create endpoint for human-named spaces.',
      parameters: {
        type: 'object',
        properties: {
          space: {
            type: 'object',
            description:
              'Space resource. Typically { displayName: "Engineering", spaceType: "SPACE" } or { spaceType: "GROUP_CHAT" }.',
          },
          requestId: {
            type: 'string',
            description: 'Optional client-supplied request ID; Chat uses it to deduplicate retries server-side.',
          },
        },
        required: ['space'],
      },
      request: {
        method: 'POST',
        path: '/spaces',
        query: { requestId: '{requestId}' },
        body: '{space}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: [SCOPE_SPACES],
    },
  ],
})
