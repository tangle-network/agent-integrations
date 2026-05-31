import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Mastodon adapter.
 *
 * Mastodon is federated: every instance (mastodon.social, fosstodon.org, a
 * private server, ...) exposes the same REST surface under its own host. The
 * activepieces piece captures this with a `base_url` field plus a long-lived
 * `access_token` issued by that instance. We model the per-tenant host as
 * `baseUrl: { metadataKey: 'baseUrl' }` so each connection resolves to the
 * instance the user authorized against, and the access token rides as a
 * bearer credential (the default api-key placement) on every call.
 *
 * The piece itself ships exactly one action — `postStatus` — which maps to
 * the public `POST /api/v1/statuses` endpoint. We also surface the read
 * paths the same credential unlocks (verify-credentials for connection
 * health, fetch-status for permalink resolution, home/account timelines for
 * polling-based triggers) so downstream tooling can compose richer flows
 * without each consumer hand-rolling Mastodon HTTP.
 */
export const mastodonConnector = declarativeRestConnector({
  kind: 'mastodon',
  displayName: 'Mastodon',
  description:
    'Post statuses to a Mastodon instance and read public / account / home timelines. Works against any Mastodon-compatible host (mastodon.social, fosstodon.org, self-hosted) — the instance base URL is per-connection metadata.',
  auth: {
    kind: 'api-key',
    hint: 'Mastodon access token issued by the target instance (Preferences → Development → New Application). The instance base URL is captured separately on the connection as the `baseUrl` metadata field.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://mastodon.social' },
  test: { method: 'GET', path: '/api/v1/accounts/verify_credentials' },
  capabilities: [
    {
      name: 'post.status',
      class: 'mutation',
      description:
        'Publish a status (toot) on behalf of the authenticated account. Maps to the activepieces `postStatus` action and the public `POST /api/v1/statuses` endpoint. `media_ids` must already be uploaded via `/api/v2/media`; `visibility` controls public / unlisted / private / direct delivery.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          media_ids: { type: 'array', items: { type: 'string' } },
          in_reply_to_id: { type: 'string' },
          sensitive: { type: 'boolean' },
          spoiler_text: { type: 'string' },
          visibility: {
            type: 'string',
            enum: ['public', 'unlisted', 'private', 'direct'],
          },
          language: { type: 'string' },
          scheduled_at: { type: 'string' },
        },
        required: ['status'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/statuses',
        body: {
          status: '{status}',
          media_ids: '{media_ids}',
          in_reply_to_id: '{in_reply_to_id}',
          sensitive: '{sensitive}',
          spoiler_text: '{spoiler_text}',
          visibility: '{visibility}',
          language: '{language}',
          scheduled_at: '{scheduled_at}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'account.verify',
      class: 'read',
      description:
        'Fetch the authenticated account (`GET /api/v1/accounts/verify_credentials`). Doubles as a credential-health probe and source-of-truth for the connection owner.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/v1/accounts/verify_credentials' },
    },
    {
      name: 'status.get',
      class: 'read',
      description:
        'Read a single status by id (`GET /api/v1/statuses/{id}`). Used to resolve a permalink, fetch counts after posting, or verify a mutation landed.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v1/statuses/{id}' },
    },
    {
      name: 'timeline.home',
      class: 'read',
      description:
        'Read the authenticated user\'s home timeline (`GET /api/v1/timelines/home`). Drives "new status in home timeline" style triggers via cursor (`max_id` / `since_id`) diffing.',
      parameters: {
        type: 'object',
        properties: {
          max_id: { type: 'string' },
          since_id: { type: 'string' },
          min_id: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/timelines/home',
        query: {
          max_id: '{max_id}',
          since_id: '{since_id}',
          min_id: '{min_id}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'timeline.public',
      class: 'read',
      description:
        'Read the public (federated) or local timeline (`GET /api/v1/timelines/public`). Set `local=true` for instance-local posts; `only_media=true` to filter to media-bearing statuses.',
      parameters: {
        type: 'object',
        properties: {
          local: { type: 'boolean' },
          remote: { type: 'boolean' },
          only_media: { type: 'boolean' },
          max_id: { type: 'string' },
          since_id: { type: 'string' },
          min_id: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/timelines/public',
        query: {
          local: '{local}',
          remote: '{remote}',
          only_media: '{only_media}',
          max_id: '{max_id}',
          since_id: '{since_id}',
          min_id: '{min_id}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'account.statuses',
      class: 'read',
      description:
        'List statuses authored by an account (`GET /api/v1/accounts/{id}/statuses`). Backs "new post by account" polling and lets flows resolve recent context for a specific user.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          exclude_replies: { type: 'boolean' },
          exclude_reblogs: { type: 'boolean' },
          only_media: { type: 'boolean' },
          pinned: { type: 'boolean' },
          tagged: { type: 'string' },
          max_id: { type: 'string' },
          since_id: { type: 'string' },
          min_id: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/accounts/{id}/statuses',
        query: {
          exclude_replies: '{exclude_replies}',
          exclude_reblogs: '{exclude_reblogs}',
          only_media: '{only_media}',
          pinned: '{pinned}',
          tagged: '{tagged}',
          max_id: '{max_id}',
          since_id: '{since_id}',
          min_id: '{min_id}',
          limit: '{limit}',
        },
      },
    },
  ],
})
