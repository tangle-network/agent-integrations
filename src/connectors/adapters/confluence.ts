import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Atlassian Confluence Cloud connector.
 *
 * Auth: OAuth 2.0 (3LO) via auth.atlassian.com. After consent, a single
 * connection may have access to multiple Atlassian sites; each is identified
 * by a `cloudId` discoverable through
 * `GET https://api.atlassian.com/oauth/token/accessible-resources`.
 * The cloudId is passed in on every capability as an explicit argument
 * (same pattern as Xero `tenantId` / Salesforce `objectName`) rather than
 * baked into connection metadata, so a single connection can target any
 * site the operator authorized.
 *
 * Base URL: `https://api.atlassian.com/ex/confluence/{cloudId}` — the gateway
 * proxies through to the customer's Confluence site.
 *
 * Capability surface covers the v2 REST API (the v1 `/wiki/rest/api/...`
 * surface is on Atlassian's deprecation track): pages list/get/create/update,
 * spaces list, and CQL search via the v1 `/wiki/rest/api/search` endpoint
 * which is still the only supported way to run CQL.
 */
export const confluenceConnector = declarativeRestConnector({
  kind: 'confluence',
  displayName: 'Confluence',
  description:
    'Search Confluence with CQL, read and update Confluence Cloud pages and spaces, and create new pages in authorized Atlassian sites.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: [
      'offline_access',
      'read:confluence-content.all',
      'read:confluence-content.summary',
      'read:confluence-space.summary',
      'write:confluence-content',
      'search:confluence',
    ],
    clientIdEnv: 'ATLASSIAN_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.atlassian.com',
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/oauth/token/accessible-resources' },
  capabilities: [
    {
      name: 'pages.list',
      class: 'read',
      description:
        'List Confluence pages in a site, optionally scoped to a single space-id. Uses the v2 cursor-paginated endpoint.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string', description: 'Atlassian site id from /oauth/token/accessible-resources.' },
          spaceId: { type: 'string', description: 'Optional space-id filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          cursor: { type: 'string', description: 'Opaque pagination cursor from a previous response.' },
        },
        required: ['cloudId'],
      },
      request: {
        method: 'GET',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/pages',
        query: { 'space-id': '{spaceId}', limit: '{limit}', cursor: '{cursor}' },
      },
      requiredScopes: ['read:confluence-content.all'],
    },
    {
      name: 'pages.get',
      class: 'read',
      description:
        'Read a single Confluence page by id, including its body in storage format.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          pageId: { type: 'string', description: 'Confluence page id.' },
          bodyFormat: {
            type: 'string',
            enum: ['storage', 'atlas_doc_format', 'view'],
            description: 'Page-body representation to return (defaults to storage).',
          },
        },
        required: ['cloudId', 'pageId'],
      },
      request: {
        method: 'GET',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}',
        query: { 'body-format': '{bodyFormat}' },
      },
      requiredScopes: ['read:confluence-content.all'],
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description:
        'Create a new Confluence page in a site. Caller assembles the full v2 page envelope (`spaceId`, `title`, optional `parentId`/`status`, and `body`) and passes it as `page`; the adapter forwards the envelope unchanged so optional fields like `parentId` can be omitted cleanly.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          page: {
            type: 'object',
            description: 'Full v2 page-create envelope.',
            properties: {
              spaceId: { type: 'string', description: 'Target space id.' },
              title: { type: 'string' },
              parentId: { type: 'string', description: 'Optional parent page id; omit for a top-level page.' },
              status: { type: 'string', enum: ['current', 'draft'] },
              body: {
                type: 'object',
                properties: {
                  representation: { type: 'string', enum: ['storage', 'atlas_doc_format', 'wiki'] },
                  value: { type: 'string' },
                },
                required: ['representation', 'value'],
              },
            },
            required: ['spaceId', 'title', 'body'],
          },
        },
        required: ['cloudId', 'page'],
      },
      request: {
        method: 'POST',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/pages',
        body: '{page}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write:confluence-content'],
    },
    {
      name: 'pages.update',
      class: 'mutation',
      description:
        'Update an existing Confluence page. Caller assembles the full v2 page-update envelope as `page` and must include the next version number — Confluence rejects mismatched versions which surfaces as a 409 conflict response.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          pageId: { type: 'string' },
          page: {
            type: 'object',
            description: 'Full v2 page-update envelope including `id`, `title`, `body`, `version`, optional `status`.',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string', enum: ['current', 'draft', 'archived'] },
              body: {
                type: 'object',
                properties: {
                  representation: { type: 'string', enum: ['storage', 'atlas_doc_format', 'wiki'] },
                  value: { type: 'string' },
                },
                required: ['representation', 'value'],
              },
              version: {
                type: 'object',
                properties: {
                  number: { type: 'integer', minimum: 1 },
                  message: { type: 'string' },
                },
                required: ['number'],
              },
            },
            required: ['id', 'title', 'body', 'version'],
          },
        },
        required: ['cloudId', 'pageId', 'page'],
      },
      request: {
        method: 'PUT',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}',
        body: '{page}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write:confluence-content'],
    },
    {
      name: 'pages.delete',
      class: 'mutation',
      description: 'Delete a Confluence page (moves it to trash for current pages).',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          pageId: { type: 'string' },
        },
        required: ['cloudId', 'pageId'],
      },
      request: {
        method: 'DELETE',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write:confluence-content'],
    },
    {
      name: 'spaces.list',
      class: 'read',
      description: 'List spaces in a Confluence site.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          cursor: { type: 'string' },
          type: { type: 'string', enum: ['global', 'personal', 'collaboration', 'knowledge_base'] },
          status: { type: 'string', enum: ['current', 'archived'] },
        },
        required: ['cloudId'],
      },
      request: {
        method: 'GET',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/spaces',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
          type: '{type}',
          status: '{status}',
        },
      },
      requiredScopes: ['read:confluence-space.summary'],
    },
    {
      name: 'spaces.get',
      class: 'read',
      description: 'Read a single Confluence space by id.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          spaceId: { type: 'string' },
        },
        required: ['cloudId', 'spaceId'],
      },
      request: {
        method: 'GET',
        path: '/ex/confluence/{cloudId}/wiki/api/v2/spaces/{spaceId}',
      },
      requiredScopes: ['read:confluence-space.summary'],
    },
    {
      name: 'search.cql',
      class: 'read',
      description:
        'Run a Confluence Query Language (CQL) search across pages, attachments, and spaces. Backed by the v1 /wiki/rest/api/search endpoint, which remains the only supported CQL surface on Confluence Cloud.',
      parameters: {
        type: 'object',
        properties: {
          cloudId: { type: 'string' },
          cql: { type: 'string', description: 'CQL expression, e.g. \'type = "page" AND space = "ENG"\'.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          start: { type: 'integer', minimum: 0, description: 'Offset for non-cursor pagination on the v1 endpoint.' },
          excerpt: {
            type: 'string',
            enum: ['indexed', 'highlight', 'none', 'highlight_unescaped', 'indexed_highlighted'],
            description: 'Excerpt style returned in search hits.',
          },
        },
        required: ['cloudId', 'cql'],
      },
      request: {
        method: 'GET',
        path: '/ex/confluence/{cloudId}/wiki/rest/api/search',
        query: {
          cql: '{cql}',
          limit: '{limit}',
          start: '{start}',
          excerpt: '{excerpt}',
        },
      },
      requiredScopes: ['search:confluence'],
    },
  ],
})
