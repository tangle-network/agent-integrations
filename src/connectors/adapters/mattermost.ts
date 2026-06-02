import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Mattermost — open-source team messaging.
 *
 * Auth model from the activepieces catalog: api-key (bot token) plus a
 * caller-supplied workspace URL. The workspace URL is the customer's
 * Mattermost instance origin (e.g. `https://activepieces.mattermost.com`);
 * REST paths hang off `/api/v4` per the Mattermost server API.
 *
 * Capabilities:
 *   - send.message  → POST   /api/v4/posts          (create a post)
 *   - update_post   → PUT    /api/v4/posts/{post_id} (edit a post message)
 *   - delete_post   → DELETE /api/v4/posts/{post_id} (soft-delete a post)
 *   - add_reaction  → POST   /api/v4/reactions      (add an emoji reaction)
 *
 * Mattermost has no header-based idempotency. update/delete are resource-
 * level idempotent (same target id ⇒ same effect), and the reactions
 * endpoint is set-semantic (same user_id+post_id+emoji_name dedupes
 * server-side), so `cas: 'native-idempotency'` is honest for all four.
 */
export const mattermostConnector = declarativeRestConnector({
  kind: 'mattermost',
  displayName: 'Mattermost',
  description: 'Post messages to Mattermost channels via a bot token on a self-hosted or cloud workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Mattermost bot personal access token; sent as `Authorization: Bearer <token>`. The workspace URL is held alongside the token in connection metadata.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  // Per-connection workspace URL — Mattermost is self-hosted by default, so
  // there is no single first-party origin. The hub resolves `workspaceUrl`
  // from the connection's metadata before each request.
  baseUrl: { metadataKey: 'workspaceUrl' },
  test: { method: 'GET', path: '/api/v4/users/me' },
  capabilities: [
    {
      name: 'send.message',
      class: 'mutation',
      description: 'Send a message (post) to a Mattermost channel.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: {
            type: 'string',
            description: 'The channel to send the message to. Found in the channel info dialog near the start-call button.',
          },
          message: {
            type: 'string',
            description: 'The text of the message to send.',
          },
          root_id: {
            type: 'string',
            description: 'Optional post id to reply to as a thread.',
          },
          props: {
            type: 'object',
            description: 'Optional post properties (e.g. attachments, override_username).',
          },
        },
        required: ['channel_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/api/v4/posts',
        body: {
          channel_id: '{channel_id}',
          message: '{message}',
          root_id: '{root_id}',
          props: '{props}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update_post',
      class: 'mutation',
      description: 'Edit an existing post (replace its message text). Mattermost rewrites the post in place and marks it `edit_at`.',
      parameters: {
        type: 'object',
        properties: {
          post_id: {
            type: 'string',
            description: 'The id of the post to update.',
          },
          message: {
            type: 'string',
            description: 'The new text of the post.',
          },
        },
        required: ['post_id', 'message'],
      },
      request: {
        method: 'PUT',
        path: '/api/v4/posts/{post_id}',
        body: {
          id: '{post_id}',
          message: '{message}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'delete_post',
      class: 'mutation',
      description: 'Soft-delete a post by id. Mattermost marks the post as deleted; the row remains for audit.',
      parameters: {
        type: 'object',
        properties: {
          post_id: {
            type: 'string',
            description: 'The id of the post to delete.',
          },
        },
        required: ['post_id'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v4/posts/{post_id}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'add_reaction',
      class: 'mutation',
      description: 'Add an emoji reaction to a post on behalf of `user_id`. Mattermost dedupes the (user, post, emoji) triple server-side.',
      parameters: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: 'The id of the user adding the reaction (typically the bot user id).',
          },
          post_id: {
            type: 'string',
            description: 'The id of the post being reacted to.',
          },
          emoji_name: {
            type: 'string',
            description: 'Emoji name without colons, e.g. "thumbsup".',
          },
        },
        required: ['user_id', 'post_id', 'emoji_name'],
      },
      request: {
        method: 'POST',
        path: '/api/v4/reactions',
        body: {
          user_id: '{user_id}',
          post_id: '{post_id}',
          emoji_name: '{emoji_name}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
