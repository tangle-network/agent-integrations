import { declarativeRestConnector } from './declarative-rest.js'

// FigJam is Figma's whiteboard product and is served by the same REST API
// and the same OAuth2 application surface as Figma. The differences are:
//   - FigJam boards expose node types like STICKY, CONNECTOR, SHAPE_WITH_TEXT,
//     STAMP, WIDGET, SECTION (in addition to FRAME / GROUP) — the agent reads
//     them through the standard /v1/files/{file_key} document tree.
//   - The webhook event stream uses the same v2 endpoints as Figma; FigJam
//     boards emit FILE_UPDATE / FILE_COMMENT alongside Figma design files.
//   - Branching, dev resources, library analytics, and component publishing
//     are Figma-design-only concepts and are intentionally NOT exposed here.
//
// OAuth2 (https://www.figma.com/developers/api#oauth2):
//   - Authorize:  https://www.figma.com/oauth
//   - Token:      https://api.figma.com/v1/oauth/token
//   - Refresh:    https://api.figma.com/v1/oauth/refresh
//
// Identifier nomenclature:
//   - file_key  : the 22-character key from https://www.figma.com/board/<file_key>/<title>
//   - node_id   : a comma-delimited list when used on /v1/files/<file_key>/nodes
//   - team_id   : numeric team id (https://www.figma.com/files/team/<team_id>)
//   - project_id: numeric project id under a team
//   - comment_id: returned from /v1/files/<file_key>/comments
export const figjamConnector = declarativeRestConnector({
  kind: 'figjam',
  displayName: 'FigJam',
  description:
    'Read FigJam boards (stickies, connectors, shapes, sections), list team/project boards, render board images, and post or delete board comments through the Figma REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    scopes: [
      'files:read',
      'file_comments:write',
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
      description: 'Return the authenticated Figma/FigJam user.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/v1/me' },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.get',
      class: 'read',
      description: 'Fetch a FigJam board by file key (full document tree, including STICKY/CONNECTOR/SHAPE_WITH_TEXT/SECTION nodes).',
      parameters: {
        type: 'object',
        properties: {
          file_key: { type: 'string' },
          version: { type: 'string' },
          ids: { type: 'string', description: 'Comma-separated node ids to scope the response.' },
          depth: { type: 'integer', minimum: 1, maximum: 4 },
          geometry: { type: 'string', enum: ['paths'] },
          plugin_data: { type: 'string' },
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
        },
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.nodes',
      class: 'read',
      description: 'Fetch one or more nodes from a FigJam board by id (e.g. a single sticky or a section subtree).',
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
      description: 'Render PNG/JPG/SVG/PDF images for a set of node ids inside a FigJam board (e.g. snapshot a section or a single sticky cluster).',
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
      description: 'List image fills referenced by a FigJam board (URLs to the source bitmaps placed on the canvas).',
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
      description: 'List historical versions saved for a FigJam board.',
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
      name: 'files.comments.list',
      class: 'read',
      description: 'List comments posted on a FigJam board (top-level threads and replies).',
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
      description: 'List projects inside a Figma team (FigJam boards live alongside Figma design files inside projects).',
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
      description: 'List files inside a project — response items expose a `type` field; FigJam boards are returned with type "jam" and design files with type "design".',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/projects/{project_id}/files',
      },
      requiredScopes: ['files:read'],
    },
    {
      name: 'files.comments.create',
      class: 'mutation',
      description: 'Post a new comment on a FigJam board (optionally pinned to a node or canvas coordinate, or threaded as a reply).',
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
      description: 'Delete a comment on a FigJam board.',
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
      description: 'Add an emoji reaction to a FigJam board comment.',
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
      description: 'Register a Figma v2 webhook for a team event stream — FigJam boards emit FILE_UPDATE / FILE_VERSION_UPDATE / FILE_DELETE / FILE_COMMENT alongside Figma files.',
      parameters: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            enum: [
              'FILE_UPDATE',
              'FILE_VERSION_UPDATE',
              'FILE_DELETE',
              'FILE_COMMENT',
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
