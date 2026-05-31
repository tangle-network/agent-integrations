import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Mattermost — open-source team messaging.
 *
 * Auth model from the activepieces catalog: api-key (bot token) plus a
 * caller-supplied workspace URL. The workspace URL is the customer's
 * Mattermost instance origin (e.g. `https://activepieces.mattermost.com`);
 * REST paths hang off `/api/v4` per the Mattermost server API.
 *
 * The catalog only ships one action (`send.message`, upstream `sendMessage`),
 * which maps to `POST /api/v4/posts`. We expose only that capability here so
 * the manifest reflects the catalog exactly.
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
  ],
})
