import { declarativeRestConnector } from './declarative-rest.js'

// Figma OAuth2 (https://www.figma.com/developers/api#oauth2):
//   - Authorize:  https://www.figma.com/oauth
//   - Token:      https://api.figma.com/v1/oauth/token
//   - Refresh:    https://api.figma.com/v1/oauth/refresh (handled by host OAuth runtime)
//
// API reference: https://www.figma.com/developers/api
// Scopes are space-delimited in the authorization URL. We request the minimum
// set required to cover the action surface below: read files + components,
// post/read file comments, and read dev-resources/library-analytics for
// design-system tooling.
//
// Identifier nomenclature:
//   - file_key  : the 22-character key from https://www.figma.com/file/<file_key>/<title>
//   - node_id   : a comma-delimited list when used on /v1/files/<file_key>/nodes
//   - team_id   : numeric team id (https://www.figma.com/files/team/<team_id>)
//   - project_id: numeric project id under a team
//   - comment_id: returned from /v1/files/<file_key>/comments
export const figmaConnector = declarativeRestConnector({
  kind: 'figma',
  displayName: 'Figma',
  description: 'Read Figma files, components, comments, and team projects; post comments back into the design source of truth.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    scopes: [
      'files:read',
      'file_variables:read',
      'file_comments:write',
      'file_dev_resources:read',
      'library_analytics:read',
      'webhooks:write',
    ],
    clientIdEnv: 'FIGMA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FIGMA_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.figma.com',
  test: { method: 'GET', path: '/v1/me' },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Return the authenticated Figma user.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/v1/me' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.get',
      class: 'read',
      description: 'Fetch a Figma file by key (full document tree).',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          version: { type: 'string' },
          ids: { type: 'string', description: 'Comma-separated node ids to scope the response.' },
          depth: { type: 'integer', minimum: 1, maximum: 4 },
          geometry: { type: 'string', enum: ['paths'] },
          plugin_data: { type: 'string' },
          branch_data: { type: 'boolean' },
        },
        required: ['file_key'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_key}',
        query: {
          version: '{version}',
          ids: '{ids}',
          depth: '{depth}',
          geometry: '{geometry}',
          plugin_data: '{plugin_data}',
          branch_data: '{branch_data}',
        },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.nodes',
      class: 'read',
      description: 'Fetch one or more nodes from a Figma file by id.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          ids: { type: 'string', description: 'Comma-separated list of node ids.' },
          version: { type: 'string' },
          depth: { type: 'integer', minimum: 1, maximum: 4 },
          geometry: { type: 'string', enum: ['paths'] },
        },
        required: ['file_key', 'ids'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_key}/nodes',
        query: { ids: '{ids}', version: '{version}', depth: '{depth}', geometry: '{geometry}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.images',
      class: 'read',
      description: 'Render images for a set of node ids inside a file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          ids: { type: 'string', description: 'Comma-separated list of node ids to render.' },
          scale: { type: 'number', minimum: 0.01, maximum: 4 },
          format: { type: 'string', enum: ['jpg', 'png', 'svg', 'pdf'] },
          svg_outline_text: { type: 'boolean' },
          svg_include_id: { type: 'boolean' },
          svg_simplify_stroke: { type: 'boolean' },
          use_absolute_bounds: { type: 'boolean' },
          version: { type: 'string' },
        },
        required: ['file_key', 'ids'],
      },
      request: {
        method: 'GET',
        path: '/v1/images/{file_key}',
        query: {
          ids: '{ids}',
          scale: '{scale}',
          format: '{format}',
          svg_outline_text: '{svg_outline_text}',
          svg_include_id: '{svg_include_id}',
          svg_simplify_stroke: '{svg_simplify_stroke}',
          use_absolute_bounds: '{use_absolute_bounds}',
          version: '{version}',
        },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.image_fills',
      class: 'read',
      description: 'List image fills referenced by a Figma file (URLs to the source bitmaps).',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/images' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.versions.list',
      class: 'read',
      description: 'List historical versions saved for a Figma file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 50 },
          before: { type: 'integer' },
          after: { type: 'integer' },
        },
        required: ['file_key'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_key}/versions',
        query: { page_size: '{page_size}', before: '{before}', after: '{after}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.components.list',
      class: 'read',
      description: 'List the components defined inside a Figma file.',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/components' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.component_sets.list',
      class: 'read',
      description: 'List the component sets (variant groups) defined inside a Figma file.',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/component_sets' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.styles.list',
      class: 'read',
      description: 'List the published styles defined inside a Figma file.',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/styles' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.variables.local',
      class: 'read',
      description: 'List locally defined variables and variable collections in a file (Enterprise-only).',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/variables/local' },
      requiredScopes: ['file_variables:read'],
    },
    {
      name: 'files.variables.published',
      class: 'read',
      description: 'List variables published from a Figma library file (Enterprise-only).',
      parameters: {
        type: 'object',
        properties: { file_key: { type: 'string' } },
        required: ['file_key'],
      },
      request: { method: 'GET', path: '/v1/files/{file_key}/variables/published' },
      requiredScopes: ['file_variables:read'],
    },
    {
      name: 'files.dev_resources.list',
      class: 'read',
      description: 'List dev-mode resource links attached to a Figma file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          node_ids: { type: 'string', description: 'Comma-separated node ids to filter dev resources.' },
        },
        required: ['file_key'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_key}/dev_resources',
        query: { node_ids: '{node_ids}' },
      },
      requiredScopes: ['file_dev_resources:read'],
    },
    {
      name: 'files.comments.list',
      class: 'read',
      description: 'List comments on a Figma file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          as_md: { type: 'boolean' },
        },
        required: ['file_key'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_key}/comments',
        query: { as_md: '{as_md}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'teams.projects.list',
      class: 'read',
      description: 'List projects inside a Figma team.',
      parameters: {
        type: 'object',
        properties: { team_id: { type: 'string' } },
        required: ['team_id'],
      },
      request: { method: 'GET', path: '/v1/teams/{team_id}/projects' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'projects.files.list',
      class: 'read',
      description: 'List Figma files inside a project.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_data: { type: 'boolean' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/projects/{project_id}/files',
        query: { branch_data: '{branch_data}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'teams.components.list',
      class: 'read',
      description: 'List published components shared across a Figma team library.',
      parameters: {
        type: 'object',
        properties: {
          team_id: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 1000 },
          after: { type: 'integer' },
          before: { type: 'integer' },
        },
        required: ['team_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/teams/{team_id}/components',
        query: { page_size: '{page_size}', after: '{after}', before: '{before}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'teams.styles.list',
      class: 'read',
      description: 'List published styles shared across a Figma team library.',
      parameters: {
        type: 'object',
        properties: {
          team_id: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 1000 },
          after: { type: 'integer' },
          before: { type: 'integer' },
        },
        required: ['team_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/teams/{team_id}/styles',
        query: { page_size: '{page_size}', after: '{after}', before: '{before}' },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'analytics.library.component_usages',
      class: 'read',
      description: 'Read library analytics: component usage rollup for a library file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          group_by: { type: 'string', enum: ['component', 'file'] },
          cursor: { type: 'string' },
        },
        required: ['file_key', 'group_by'],
      },
      request: {
        method: 'GET',
        path: '/v1/analytics/libraries/{file_key}/component/usages',
        query: { group_by: '{group_by}', cursor: '{cursor}' },
      },
      requiredScopes: ['library_analytics:read'],
    },
    {
      name: 'files.comments.create',
      class: 'mutation',
      description: 'Post a new comment on a Figma file (optionally pinned to a node or canvas coordinate).',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          message: { type: 'string' },
          comment_id: { type: 'string', description: 'Reply to an existing comment by id.' },
          client_meta: {
            type: 'object',
            description: 'Either { x, y } canvas coordinates or { node_id, node_offset: { x, y } } to pin to a node.',
          },
        },
        required: ['file_key', 'message'],
      },
      request: {
        method: 'POST',
        path: '/v1/files/{file_key}/comments',
        body: { message: '{message}', comment_id: '{comment_id}', client_meta: '{client_meta}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['file_comments:write'],
    },
    {
      name: 'files.comments.delete',
      class: 'mutation',
      description: 'Delete a comment on a Figma file.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          comment_id: { type: 'string' },
        },
        required: ['file_key', 'comment_id'],
      },
      request: { method: 'DELETE', path: '/v1/files/{file_key}/comments/{comment_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['file_comments:write'],
    },
    {
      name: 'files.comments.reactions.add',
      class: 'mutation',
      description: 'Add an emoji reaction to a Figma comment.',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          comment_id: { type: 'string' },
          emoji: { type: 'string', description: 'Emoji shortcode, e.g. :heart:.' },
        },
        required: ['file_key', 'comment_id', 'emoji'],
      },
      request: {
        method: 'POST',
        path: '/v1/files/{file_key}/comments/{comment_id}/reactions',
        body: { emoji: '{emoji}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['file_comments:write'],
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description: 'Register a Figma v2 webhook for a team event stream (FILE_UPDATE, FILE_COMMENT, etc.).',
      parameters: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            enum: [
              'FILE_UPDATE',
              'FILE_VERSION_UPDATE',
              'FILE_DELETE',
              'LIBRARY_PUBLISH',
              'FILE_COMMENT',
              'DEV_MODE_STATUS_UPDATE',
            ],
          },
          team_id: { type: 'string' },
          endpoint: { type: 'string', format: 'uri' },
          passcode: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'PAUSED'] },
          description: { type: 'string' },
        },
        required: ['event_type', 'team_id', 'endpoint', 'passcode'],
      },
      request: {
        method: 'POST',
        path: '/v2/webhooks',
        body: {
          event_type: '{event_type}',
          team_id: '{team_id}',
          endpoint: '{endpoint}',
          passcode: '{passcode}',
          status: '{status}',
          description: '{description}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['webhooks:write'],
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Delete a Figma v2 webhook by id.',
      parameters: {
        type: 'object',
        properties: { webhook_id: { type: 'string' } },
        required: ['webhook_id'],
      },
      request: { method: 'DELETE', path: '/v2/webhooks/{webhook_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['webhooks:write'],
    },
  ],
})
