import { declarativeRestConnector } from './declarative-rest.js'

// Discord exposes a single REST surface at discord.com/api/v10 covering guilds
// (servers), channels, messages, members, and roles. OAuth2 user-grant tokens
// are Bearer-prefixed and scope-gated; bot tokens use a different `Bot ` prefix
// and are issued out-of-band via the developer portal. This adapter targets the
// OAuth2 user-grant path — the same client the Discord dev portal uses — which
// is the only flow that fits the hub's connection-issuance model.
//
// Consistency: Discord messages are append-only and advisory. We mark
// defaultConsistencyModel: 'advisory' so the planner does not promise
// transactional outcomes; CAS on send_message is 'none' because Discord exposes
// no ETag / If-Match path for message creation. Edits and deletes use the
// message id as a natural idempotency anchor and the snowflake makes
// optimistic-read-verify cheap.
export const discordConnector = declarativeRestConnector({
  kind: 'discord',
  displayName: 'Discord',
  description:
    'Read Discord guilds, channels, members, and messages, and post or edit messages on behalf of a connected user.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: [
      'identify',
      'email',
      'guilds',
      'guilds.members.read',
      'messages.read',
      'webhook.incoming',
    ],
    clientIdEnv: 'DISCORD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DISCORD_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://discord.com/api/v10',
  test: { method: 'GET', path: '/users/@me' },
  capabilities: [
    {
      name: 'users.me',
      class: 'read',
      description: 'Return the connected Discord user (id, username, email if granted, avatar).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/users/@me' },
      requiredScopes: ['identify'],
    },
    {
      name: 'guilds.list',
      class: 'read',
      description:
        'List guilds (servers) the connected user is a member of. Pagination via `before`, `after`, `limit` (max 200).',
      parameters: {
        type: 'object',
        properties: {
          before: { type: 'string', description: 'Snowflake id; return guilds before this id.' },
          after: { type: 'string', description: 'Snowflake id; return guilds after this id.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 200 },
        },
      },
      request: {
        method: 'GET',
        path: '/users/@me/guilds',
        query: { before: '{before}', after: '{after}', limit: '{limit}' },
      },
      requiredScopes: ['guilds'],
    },
    {
      name: 'guilds.get',
      class: 'read',
      description: 'Read a single guild by id.',
      parameters: {
        type: 'object',
        properties: { guildId: { type: 'string' } },
        required: ['guildId'],
      },
      request: { method: 'GET', path: '/guilds/{guildId}' },
      requiredScopes: ['guilds'],
    },
    {
      name: 'guilds.channels.list',
      class: 'read',
      description: 'List channels in a guild.',
      parameters: {
        type: 'object',
        properties: { guildId: { type: 'string' } },
        required: ['guildId'],
      },
      request: { method: 'GET', path: '/guilds/{guildId}/channels' },
      requiredScopes: ['guilds'],
    },
    {
      name: 'guilds.members.list',
      class: 'read',
      description: 'List guild members. Requires `guilds.members.read` scope.',
      parameters: {
        type: 'object',
        properties: {
          guildId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
          after: { type: 'string', description: 'Snowflake id; pagination cursor.' },
        },
        required: ['guildId'],
      },
      request: {
        method: 'GET',
        path: '/guilds/{guildId}/members',
        query: { limit: '{limit}', after: '{after}' },
      },
      requiredScopes: ['guilds.members.read'],
    },
    {
      name: 'guilds.members.get',
      class: 'read',
      description: 'Read a single member of a guild by user id.',
      parameters: {
        type: 'object',
        properties: {
          guildId: { type: 'string' },
          userId: { type: 'string' },
        },
        required: ['guildId', 'userId'],
      },
      request: { method: 'GET', path: '/guilds/{guildId}/members/{userId}' },
      requiredScopes: ['guilds.members.read'],
    },
    {
      name: 'channels.get',
      class: 'read',
      description: 'Read a channel by id.',
      parameters: {
        type: 'object',
        properties: { channelId: { type: 'string' } },
        required: ['channelId'],
      },
      request: { method: 'GET', path: '/channels/{channelId}' },
      requiredScopes: ['guilds'],
    },
    {
      name: 'channels.messages.list',
      class: 'read',
      description:
        'List messages in a channel. Pagination uses snowflake cursors `before`, `after`, `around`; `limit` max 100.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' },
          around: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
        required: ['channelId'],
      },
      request: {
        method: 'GET',
        path: '/channels/{channelId}/messages',
        query: {
          before: '{before}',
          after: '{after}',
          around: '{around}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['messages.read'],
    },
    {
      name: 'channels.messages.get',
      class: 'read',
      description: 'Read a single message from a channel by id.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['channelId', 'messageId'],
      },
      request: { method: 'GET', path: '/channels/{channelId}/messages/{messageId}' },
      requiredScopes: ['messages.read'],
    },
    {
      name: 'channels.messages.create',
      class: 'mutation',
      description:
        'Post a message to a channel. Provide `content` or `embeds`. Append-only — no CAS — the caller owns dedupe via idempotencyKey.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          content: { type: 'string' },
          tts: { type: 'boolean' },
          embeds: { type: 'array', items: { type: 'object' }, description: 'Discord embed objects.' },
          allowed_mentions: { type: 'object' },
          message_reference: {
            type: 'object',
            description: 'Reply target: { message_id, channel_id?, guild_id?, fail_if_not_exists? }.',
          },
          components: {
            type: 'array',
            items: { type: 'object' },
            description: 'Message components (action rows / buttons).',
          },
          flags: { type: 'integer', description: 'Bitfield of message flags.' },
        },
        required: ['channelId'],
      },
      request: {
        method: 'POST',
        path: '/channels/{channelId}/messages',
        body: {
          content: '{content}',
          tts: '{tts}',
          embeds: '{embeds}',
          allowed_mentions: '{allowed_mentions}',
          message_reference: '{message_reference}',
          components: '{components}',
          flags: '{flags}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'channels.messages.update',
      class: 'mutation',
      description: 'Edit a previously posted message. Only the message author can edit.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          messageId: { type: 'string' },
          content: { type: 'string' },
          embeds: { type: 'array', items: { type: 'object' } },
          allowed_mentions: { type: 'object' },
          components: { type: 'array', items: { type: 'object' } },
          flags: { type: 'integer' },
        },
        required: ['channelId', 'messageId'],
      },
      request: {
        method: 'PATCH',
        path: '/channels/{channelId}/messages/{messageId}',
        body: {
          content: '{content}',
          embeds: '{embeds}',
          allowed_mentions: '{allowed_mentions}',
          components: '{components}',
          flags: '{flags}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'channels.messages.delete',
      class: 'mutation',
      description: 'Delete a message. Idempotent on the message id.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['channelId', 'messageId'],
      },
      request: { method: 'DELETE', path: '/channels/{channelId}/messages/{messageId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'channels.messages.reactions.create',
      class: 'mutation',
      description:
        'Add a reaction to a message. `emoji` is URL-encoded by the request engine; unicode emoji or `name:id` for custom.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          messageId: { type: 'string' },
          emoji: { type: 'string', description: 'Unicode emoji or `name:id` for a custom guild emoji.' },
        },
        required: ['channelId', 'messageId', 'emoji'],
      },
      request: {
        method: 'PUT',
        path: '/channels/{channelId}/messages/{messageId}/reactions/{emoji}/@me',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'channels.threads.create',
      class: 'mutation',
      description: 'Create a thread in a channel without an anchor message.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          name: { type: 'string' },
          type: {
            type: 'integer',
            description:
              'Channel type: 11 = public thread, 12 = private thread, 10 = announcement thread.',
          },
          auto_archive_duration: {
            type: 'integer',
            enum: [60, 1440, 4320, 10080],
            description: 'Minutes of inactivity before auto-archive.',
          },
          invitable: { type: 'boolean' },
          rate_limit_per_user: { type: 'integer', minimum: 0, maximum: 21600 },
        },
        required: ['channelId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/channels/{channelId}/threads',
        body: {
          name: '{name}',
          type: '{type}',
          auto_archive_duration: '{auto_archive_duration}',
          invitable: '{invitable}',
          rate_limit_per_user: '{rate_limit_per_user}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
