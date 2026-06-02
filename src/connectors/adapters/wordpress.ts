/**
 * @stable WordPress.com connector — read, create, update, and delete posts,
 * pages, media, and comments through the WordPress REST API as proxied by
 * WordPress.com's public OAuth-protected endpoint.
 *
 * All capabilities are scoped to a single `site` identifier (the connection
 * UI collects a WordPress.com domain like "example.wordpress.com" or a
 * numeric site ID; both forms are accepted by `/wp/v2/sites/{site}/...`).
 * The site identifier is passed per-action so a single OAuth connection can
 * address every site the granting user has access to.
 *
 * Auth: OAuth2 against `public-api.wordpress.com`. Bearer-token access. Scopes
 * requested:
 *   - `posts`    — read + write posts, pages
 *   - `media`    — upload + read media items
 *   - `comments` — read + moderate comments
 *
 * Base URL: `https://public-api.wordpress.com`. The WordPress REST API lives
 * under `/wp/v2/sites/{site}/...` and accepts JSON bodies on create/update.
 *
 * Versioning: WordPress doesn't surface HTTP ETags on REST resources, but
 * every post/page response carries a `modified_gmt` timestamp. Mutations are
 * marked `native-idempotency` because the API rejects identical create
 * requests with the same `slug` and accepts repeated updates against a stable
 * resource ID.
 */

import { declarativeRestConnector } from './declarative-rest.js'

const siteLocator = {
  site: {
    type: 'string',
    description:
      'WordPress.com site identifier — either the site domain (e.g. "example.wordpress.com") or the numeric site ID.',
  },
} as const

export const wordpressConnector = declarativeRestConnector({
  kind: 'wordpress',
  displayName: 'WordPress',
  description:
    'Read, create, update, and delete WordPress posts, pages, media, and comments via the WordPress.com REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://public-api.wordpress.com/oauth2/authorize',
    tokenUrl: 'https://public-api.wordpress.com/oauth2/token',
    scopes: ['posts', 'media', 'comments'],
    clientIdEnv: 'WORDPRESS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WORDPRESS_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://public-api.wordpress.com',
  test: { method: 'GET', path: '/wp/v2/sites/' },
  capabilities: [
    {
      name: 'posts.list',
      class: 'read',
      description:
        'List posts on a site, optionally filtered by status, author, search term, or pagination.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          status: {
            type: 'string',
            description:
              'Comma-separated WordPress post statuses (publish, future, draft, pending, private). Defaults to "publish".',
          },
          search: { type: 'string', description: 'Full-text search filter.' },
          author: { type: 'integer', description: 'Restrict to posts by this user ID.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['site'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/posts',
        query: {
          status: '{status}',
          search: '{search}',
          author: '{author}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['posts'],
    },
    {
      name: 'posts.get',
      class: 'read',
      description: 'Fetch a single WordPress post by ID.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer', description: 'Post ID.' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/posts/{id}',
      },
      requiredScopes: ['posts'],
    },
    {
      name: 'posts.create',
      class: 'mutation',
      description:
        'Create a WordPress post. `content` is HTML or Gutenberg block markup. Set `status` to "draft" to skip publication.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          title: { type: 'string' },
          content: { type: 'string', description: 'Post body. HTML or Gutenberg block markup.' },
          excerpt: { type: 'string' },
          slug: { type: 'string' },
          status: {
            type: 'string',
            enum: ['publish', 'future', 'draft', 'pending', 'private'],
          },
          categories: { type: 'array', items: { type: 'integer' } },
          tags: { type: 'array', items: { type: 'integer' } },
          featured_media: { type: 'integer', description: 'Attachment ID to use as the featured image.' },
        },
        required: ['site', 'title'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/posts',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'posts.update',
      class: 'mutation',
      description: 'Update fields on an existing WordPress post.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          title: { type: 'string' },
          content: { type: 'string' },
          excerpt: { type: 'string' },
          slug: { type: 'string' },
          status: {
            type: 'string',
            enum: ['publish', 'future', 'draft', 'pending', 'private'],
          },
          categories: { type: 'array', items: { type: 'integer' } },
          tags: { type: 'array', items: { type: 'integer' } },
          featured_media: { type: 'integer' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/posts/{id}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'posts.delete',
      class: 'mutation',
      description:
        'Move a post to trash, or permanently delete it when `force` is true. WordPress trashes by default and only second deletes hard-delete.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          force: { type: 'boolean', description: 'Bypass trash and permanently delete.' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'DELETE',
        path: '/wp/v2/sites/{site}/posts/{id}',
        query: { force: '{force}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'pages.list',
      class: 'read',
      description: 'List static pages on a site.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          status: { type: 'string' },
          search: { type: 'string' },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['site'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/pages',
        query: {
          status: '{status}',
          search: '{search}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['posts'],
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description: 'Create a static page on a site.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          title: { type: 'string' },
          content: { type: 'string' },
          slug: { type: 'string' },
          status: {
            type: 'string',
            enum: ['publish', 'future', 'draft', 'pending', 'private'],
          },
          parent: { type: 'integer', description: 'Parent page ID for nested hierarchy.' },
        },
        required: ['site', 'title'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/pages',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'pages.update',
      class: 'mutation',
      description: 'Update fields on an existing WordPress page.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          title: { type: 'string' },
          content: { type: 'string' },
          slug: { type: 'string' },
          status: {
            type: 'string',
            enum: ['publish', 'future', 'draft', 'pending', 'private'],
          },
          parent: { type: 'integer' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/pages/{id}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'pages.delete',
      class: 'mutation',
      description:
        'Move a page to trash, or permanently delete it when `force` is true.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          force: { type: 'boolean', description: 'Bypass trash and permanently delete.' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'DELETE',
        path: '/wp/v2/sites/{site}/pages/{id}',
        query: { force: '{force}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Create a comment on a post.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          post: { type: 'integer', description: 'Post ID to comment on.' },
          content: { type: 'string' },
          author_name: { type: 'string' },
          author_email: { type: 'string' },
          parent: { type: 'integer', description: 'Parent comment ID for threaded replies.' },
        },
        required: ['site', 'post', 'content'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/comments',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['comments'],
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description:
        'Trash a comment, or permanently delete it when `force` is true.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          force: { type: 'boolean' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'DELETE',
        path: '/wp/v2/sites/{site}/comments/{id}',
        query: { force: '{force}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['comments'],
    },
    {
      name: 'media.upload',
      class: 'mutation',
      description:
        'Register a media asset on the site. Accepts the public URL of the source asset (WordPress.com sideloads from URL when supplied with `source_url`).',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          source_url: {
            type: 'string',
            description: 'Public URL WordPress should sideload as a media item.',
          },
          title: { type: 'string' },
          caption: { type: 'string' },
          alt_text: { type: 'string' },
          post: {
            type: 'integer',
            description: 'Attach the uploaded media to this post ID.',
          },
        },
        required: ['site', 'source_url'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/media',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['media'],
    },
    {
      name: 'media.list',
      class: 'read',
      description: 'List media items on a site.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          media_type: {
            type: 'string',
            enum: ['image', 'video', 'audio', 'application'],
          },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['site'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/media',
        query: {
          media_type: '{media_type}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['media'],
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments on a site, optionally filtered by post or status.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          post: { type: 'integer', description: 'Restrict to comments on this post ID.' },
          status: {
            type: 'string',
            enum: ['approve', 'hold', 'spam', 'trash'],
          },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['site'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/comments',
        query: {
          post: '{post}',
          status: '{status}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['comments'],
    },
    {
      name: 'comments.update',
      class: 'mutation',
      description:
        'Moderate a comment by setting its status (approve, hold, spam, trash) or editing its content.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          id: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['approve', 'hold', 'spam', 'trash'],
          },
          content: { type: 'string' },
        },
        required: ['site', 'id'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/comments/{id}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
      requiredScopes: ['comments'],
    },
    {
      name: 'categories.create',
      class: 'mutation',
      description:
        'Create a taxonomy category on a site. `name` is required; `slug`, `description`, and `parent` (parent category ID) are optional.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          name: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string' },
          parent: { type: 'integer', description: 'Parent category ID for nested hierarchy.' },
        },
        required: ['site', 'name'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/categories',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'tags.create',
      class: 'mutation',
      description:
        'Create a taxonomy tag on a site. `name` is required; `slug` and `description` are optional.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          name: { type: 'string' },
          slug: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['site', 'name'],
      },
      request: {
        method: 'POST',
        path: '/wp/v2/sites/{site}/tags',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['posts'],
    },
    {
      name: 'users.list',
      class: 'read',
      description:
        'List users (authors) on a site. Optionally filter by role (administrator, editor, author, contributor, subscriber) or search.',
      parameters: {
        type: 'object',
        properties: {
          ...siteLocator,
          search: { type: 'string' },
          roles: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['administrator', 'editor', 'author', 'contributor', 'subscriber'],
            },
          },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['site'],
      },
      request: {
        method: 'GET',
        path: '/wp/v2/sites/{site}/users',
        query: {
          search: '{search}',
          roles: '{roles}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
      requiredScopes: ['posts'],
    },
  ],
})
