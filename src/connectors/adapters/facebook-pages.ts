import { declarativeRestConnector } from './declarative-rest.js'

// Facebook Pages exposes a single REST surface at graph.facebook.com/v19.0 covering
// pages owned/managed by the connected user, the posts (feed) timeline of each page,
// page comments, and basic insights/audience metrics. OAuth2 user-grant tokens are
// Bearer-prefixed; page-level actions require a separately-fetched Page Access Token
// (via /me/accounts) which the caller scopes per-action. This adapter targets the
// OAuth2 user-grant flow and exposes /me/accounts so the planner can discover and
// switch between the pages a user manages.
//
// Consistency: page posts are append-only and advisory. We mark
// defaultConsistencyModel: 'advisory' so the planner does not promise transactional
// outcomes; CAS on posts.create is 'none' (Facebook exposes no If-Match path for
// post creation). Edits and deletes use the post id as a natural idempotency anchor
// and optimistic-read-verify is cheap.
export const facebookPagesConnector = declarativeRestConnector({
  kind: 'facebook-pages',
  displayName: 'Facebook Pages',
  description:
    'Read Facebook pages the connected user manages, post and edit page updates, manage comments, and read basic page insights.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_read_user_content',
      'pages_manage_posts',
      'pages_manage_engagement',
      'pages_manage_metadata',
              'read_insights',
    ],
    clientIdEnv: 'FACEBOOK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://graph.facebook.com/v19.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'users.me',
      class: 'read',
      description:
        'Return the connected Facebook user (id, name) for the granted access token.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'string',
            description: 'Comma-separated Graph field selector (e.g. "id,name,email").',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/me',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['pages_show_list'],
    },
    {
      name: 'pages.list',
      class: 'read',
      description:
        'List Facebook pages the connected user manages. Each entry includes a Page Access Token usable for page-scoped actions.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'string',
            description:
              'Comma-separated Graph field selector. Default returns id,name,access_token,category,tasks.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string', description: 'Cursor-style pagination token.' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/accounts',
        query: { fields: '{fields}', limit: '{limit}', after: '{after}' },
      },
      requiredScopes: ['pages_show_list'],
    },
    {
      name: 'pages.get',
      class: 'read',
      description: 'Read a single Facebook page by id.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          fields: {
            type: 'string',
            description: 'Comma-separated Graph field selector.',
          },
        },
        required: ['pageId'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['pages_show_list'],
    },
    {
      name: 'pages.feed.list',
      class: 'read',
      description:
        'List posts on a page feed. Pagination via `limit`, `after`, `before` cursors; time range via `since` / `until` (unix or strtotime).',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string' },
          before: { type: 'string' },
          since: { type: 'string' },
          until: { type: 'string' },
        },
        required: ['pageId'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}/feed',
        query: {
          fields: '{fields}',
          limit: '{limit}',
          after: '{after}',
          before: '{before}',
          since: '{since}',
          until: '{until}',
        },
      },
      requiredScopes: ['pages_read_engagement', 'pages_read_user_content'],
    },
    {
      name: 'pages.published_posts.list',
      class: 'read',
      description:
        'List posts the page itself published (excludes visitor posts). Same pagination as pages.feed.list.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string' },
          before: { type: 'string' },
          since: { type: 'string' },
          until: { type: 'string' },
        },
        required: ['pageId'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}/published_posts',
        query: {
          fields: '{fields}',
          limit: '{limit}',
          after: '{after}',
          before: '{before}',
          since: '{since}',
          until: '{until}',
        },
      },
      requiredScopes: ['pages_read_engagement'],
    },
    {
      name: 'posts.get',
      class: 'read',
      description: 'Read a single page post by id.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'Graph post id, typically `{pageId}_{postId}`.' },
          fields: { type: 'string' },
        },
        required: ['postId'],
      },
      request: {
        method: 'GET',
        path: '/{postId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['pages_read_engagement'],
    },
    {
      name: 'posts.comments.list',
      class: 'read',
      description:
        'List comments on a post. Use `filter=toplevel` (default) or `stream` for nested chronological order.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
          fields: { type: 'string' },
          filter: { type: 'string', enum: ['toplevel', 'stream'], default: 'toplevel' },
          order: { type: 'string', enum: ['chronological', 'reverse_chronological'] },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string' },
        },
        required: ['postId'],
      },
      request: {
        method: 'GET',
        path: '/{postId}/comments',
        query: {
          fields: '{fields}',
          filter: '{filter}',
          order: '{order}',
          limit: '{limit}',
          after: '{after}',
        },
      },
      requiredScopes: ['pages_read_user_content'],
    },
    {
      name: 'pages.insights.read',
      class: 'read',
      description:
        'Read page-level insights metrics (e.g. page_impressions, page_engaged_users). Caller passes the metric name plus optional period.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          metric: {
            type: 'string',
            description: 'Comma-separated metric names per the Graph Insights reference.',
          },
          period: { type: 'string', enum: ['day', 'week', 'days_28', 'lifetime'] },
          since: { type: 'string' },
          until: { type: 'string' },
        },
        required: ['pageId', 'metric'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}/insights',
        query: {
          metric: '{metric}',
          period: '{period}',
          since: '{since}',
          until: '{until}',
        },
      },
      requiredScopes: ['read_insights'],
    },
    {
      name: 'pages.feed.create',
      class: 'mutation',
      description:
        'Publish a post to a page feed. Provide `message` and/or `link`. Append-only — no CAS — caller owns dedupe via idempotencyKey. Requires a Page Access Token bound to the target page.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          message: { type: 'string' },
          link: { type: 'string', description: 'URL to attach to the post.' },
          published: {
            type: 'boolean',
            description: 'false to create as an unpublished draft (default true).',
          },
          scheduled_publish_time: {
            type: 'integer',
            description: 'Unix timestamp for scheduled publishing; requires published=false.',
          },
          targeting: {
            type: 'object',
            description: 'Audience targeting spec (locales, countries, etc.).',
          },
          feed_targeting: {
            type: 'object',
            description: 'News-feed targeting spec.',
          },
        },
        required: ['pageId'],
      },
      request: {
        method: 'POST',
        path: '/{pageId}/feed',
        body: {
          message: '{message}',
          link: '{link}',
          published: '{published}',
          scheduled_publish_time: '{scheduled_publish_time}',
          targeting: '{targeting}',
          feed_targeting: '{feed_targeting}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['pages_manage_posts'],
    },
    {
      name: 'pages.photos.create',
      class: 'mutation',
      description:
        'Upload a photo to a page. Provide either `url` (Facebook fetches the asset) or `source` (multipart upload). Append-only — no CAS.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          url: { type: 'string', description: 'Publicly fetchable URL of the photo.' },
          caption: { type: 'string' },
          published: { type: 'boolean' },
          scheduled_publish_time: { type: 'integer' },
          temporary: {
            type: 'boolean',
            description: 'Upload as unpublished, returns a media id for later attachment.',
          },
        },
        required: ['pageId'],
      },
      request: {
        method: 'POST',
        path: '/{pageId}/photos',
        body: {
          url: '{url}',
          caption: '{caption}',
          published: '{published}',
          scheduled_publish_time: '{scheduled_publish_time}',
          temporary: '{temporary}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['pages_manage_posts'],
    },
    {
      name: 'posts.update',
      class: 'mutation',
      description:
        'Edit a previously published page post. Only `message` and a few attachment fields are editable post-publish.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
          message: { type: 'string' },
          is_published: { type: 'boolean' },
          scheduled_publish_time: { type: 'integer' },
        },
        required: ['postId'],
      },
      request: {
        method: 'POST',
        path: '/{postId}',
        body: {
          message: '{message}',
          is_published: '{is_published}',
          scheduled_publish_time: '{scheduled_publish_time}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
      requiredScopes: ['pages_manage_posts'],
    },
    {
      name: 'posts.delete',
      class: 'mutation',
      description: 'Delete a page post. Idempotent on the post id.',
      parameters: {
        type: 'object',
        properties: { postId: { type: 'string' } },
        required: ['postId'],
      },
      request: { method: 'DELETE', path: '/{postId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['pages_manage_posts'],
    },
    {
      name: 'posts.comments.create',
      class: 'mutation',
      description:
        'Post a comment on a page post (or reply via parent comment id passed as postId). Append-only — caller owns dedupe via idempotencyKey.',
      parameters: {
        type: 'object',
        properties: {
          postId: {
            type: 'string',
            description: 'Post id, or a parent comment id to reply to.',
          },
          message: { type: 'string' },
          attachment_url: { type: 'string' },
          attachment_id: { type: 'string' },
        },
        required: ['postId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/{postId}/comments',
        body: {
          message: '{message}',
          attachment_url: '{attachment_url}',
          attachment_id: '{attachment_id}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['pages_manage_engagement'],
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description: 'Delete a comment by id. Idempotent on the comment id.',
      parameters: {
        type: 'object',
        properties: { commentId: { type: 'string' } },
        required: ['commentId'],
      },
      request: { method: 'DELETE', path: '/{commentId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['pages_manage_engagement'],
    },
  ],
})
