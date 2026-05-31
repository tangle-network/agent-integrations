import { declarativeRestConnector } from './declarative-rest.js'

// Miro REST API v2 — https://developers.miro.com/reference/api-reference
//
// OAuth 2.0 (3LO) endpoints:
//   - Authorize: https://miro.com/oauth/authorize
//   - Token:     https://api.miro.com/v1/oauth/token
//   - Refresh:   POST https://api.miro.com/v1/oauth/token with
//                grant_type=refresh_token (handled by host OAuth runtime)
//
// Auth reference: https://developers.miro.com/docs/getting-started-with-oauth
//
// Scopes are space-delimited in the authorization URL. We request the set
// needed to drive the capability surface below: read boards and their items,
// create / update / delete items, run board content search, and read team /
// organization metadata for board placement decisions.
//
// Identifier nomenclature (Miro's docs are precise about these):
//   - board_id : opaque 13-char board id from the board URL after `/app/board/`.
//   - item_id  : opaque numeric id for any item on a board (sticky, shape,
//                text, frame, card, image, embed, app card, connector).
//   - team_id  : numeric team id; an organization can have many teams.
//   - org_id   : numeric organization id (Enterprise plans only for most
//                organization-scoped endpoints).
//
// Item model: Miro stores every board element as an `item` discriminated by
// `data.shape` / endpoint. We expose the typed creation endpoints for the
// most common shapes (sticky_note, text, shape, card, image, frame) plus the
// generic `items.list` / `items.get` / `items.delete` that work across all
// item kinds.
export const miroConnector = declarativeRestConnector({
  kind: 'miro',
  displayName: 'Miro',
  description:
    'Read and edit Miro boards: list and search boards, read board items (sticky notes, shapes, text, cards, images, frames, connectors), create and update items, and post board content back into the source of truth.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://miro.com/oauth/authorize',
    tokenUrl: 'https://api.miro.com/v1/oauth/token',
    scopes: [
      'boards:read',
      'boards:write',
      'identity:read',
      'team:read',
      'organizations:read',
    ],
    clientIdEnv: 'MIRO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MIRO_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.miro.com',
  defaultHeaders: { accept: 'application/json' },
  // GET /v2/me returns the authenticated user — Miro's documented health probe.
  test: { method: 'GET', path: '/v2/me' },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Return the authenticated Miro user.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/me' },
      requiredScopes: ['identity:read'],
    },
    {
      name: 'boards.list',
      class: 'read',
      description:
        'List boards accessible to the authenticated user. Supports cursor pagination via `cursor` and team / sort filters.',
      parameters: {
        type: 'object',
        properties: {
          team_id: { type: 'string', description: 'Filter to a single team id.' },
          query: { type: 'string', description: 'Free-text board name filter.' },
          owner: { type: 'string', description: 'Filter by owner user id.' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          offset: { type: 'integer', minimum: 0 },
          sort: {
            type: 'string',
            enum: ['default', 'last_modified', 'last_opened', 'last_created', 'alphabetically'],
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/boards',
        query: {
          team_id: '{team_id}',
          query: '{query}',
          owner: '{owner}',
          limit: '{limit}',
          offset: '{offset}',
          sort: '{sort}',
        },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'boards.get',
      class: 'read',
      description: 'Fetch a single Miro board by id.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string' } },
        required: ['board_id'],
      },
      request: { method: 'GET', path: '/v2/boards/{board_id}' },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'boards.members.list',
      class: 'read',
      description: 'List members (collaborators) of a Miro board.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['board_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/boards/{board_id}/members',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'items.list',
      class: 'read',
      description:
        'List all items on a board, optionally filtered by item type (sticky_note, text, shape, card, image, frame, connector, embed, app_card, document).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'sticky_note',
              'text',
              'shape',
              'card',
              'image',
              'frame',
              'connector',
              'embed',
              'app_card',
              'document',
              'preview',
            ],
          },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          cursor: { type: 'string' },
        },
        required: ['board_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/boards/{board_id}/items',
        query: { type: '{type}', limit: '{limit}', cursor: '{cursor}' },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'items.get',
      class: 'read',
      description: 'Fetch a single board item by id.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          item_id: { type: 'string' },
        },
        required: ['board_id', 'item_id'],
      },
      request: { method: 'GET', path: '/v2/boards/{board_id}/items/{item_id}' },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'connectors.list',
      class: 'read',
      description: 'List connector lines on a board (arrows / lines between items).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          cursor: { type: 'string' },
        },
        required: ['board_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/boards/{board_id}/connectors',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'tags.list',
      class: 'read',
      description: 'List tags defined on a board.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['board_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/boards/{board_id}/tags',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'organizations.get',
      class: 'read',
      description: 'Read an organization (Enterprise plan).',
      parameters: {
        type: 'object',
        properties: { org_id: { type: 'string' } },
        required: ['org_id'],
      },
      request: { method: 'GET', path: '/v2/orgs/{org_id}' },
      requiredScopes: ['organizations:read'],
    },
    {
      name: 'organizations.teams.list',
      class: 'read',
      description: 'List teams in an organization (Enterprise plan).',
      parameters: {
        type: 'object',
        properties: {
          org_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
        },
        required: ['org_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/orgs/{org_id}/teams',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
      requiredScopes: ['organizations:read'],
    },
    {
      name: 'teams.get',
      class: 'read',
      description: 'Fetch a single team by id.',
      parameters: {
        type: 'object',
        properties: {
          org_id: { type: 'string' },
          team_id: { type: 'string' },
        },
        required: ['org_id', 'team_id'],
      },
      request: { method: 'GET', path: '/v2/orgs/{org_id}/teams/{team_id}' },
      requiredScopes: ['team:read'],
    },
    {
      name: 'boards.create',
      class: 'mutation',
      description:
        'Create a new Miro board. Accepts an optional name, description, team_id, and sharing policy. Returns the new board id used by every items.* endpoint.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          description: { type: 'string', maxLength: 300 },
          team_id: { type: 'string' },
          policy: {
            type: 'object',
            description:
              'Permissions + sharing policy. See https://developers.miro.com/reference/create-board for the full PolicyChange shape.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards',
        body: {
          name: '{name}',
          description: '{description}',
          teamId: '{team_id}',
          policy: '{policy}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'boards.update',
      class: 'mutation',
      description: 'Update a Miro board (name, description, team, or sharing policy).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          name: { type: 'string', maxLength: 60 },
          description: { type: 'string', maxLength: 300 },
          team_id: { type: 'string' },
          policy: { type: 'object' },
        },
        required: ['board_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/boards/{board_id}',
        body: {
          name: '{name}',
          description: '{description}',
          teamId: '{team_id}',
          policy: '{policy}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'boards.delete',
      class: 'mutation',
      description: 'Delete a Miro board (irreversible).',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string' } },
        required: ['board_id'],
      },
      request: { method: 'DELETE', path: '/v2/boards/{board_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'sticky_notes.create',
      class: 'mutation',
      description:
        'Create a sticky note on a board. `data.content` accepts plain text; `style.fillColor` is a Miro sticky-note color keyword (e.g. yellow, light_yellow, pink).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              shape: { type: 'string', enum: ['square', 'rectangle'] },
            },
            required: ['content'],
          },
          style: {
            type: 'object',
            properties: {
              fillColor: { type: 'string' },
              textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
              textAlignVertical: { type: 'string', enum: ['top', 'middle', 'bottom'] },
            },
          },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              origin: { type: 'string', enum: ['center'] },
            },
          },
          geometry: {
            type: 'object',
            properties: {
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          parent: {
            type: 'object',
            description: 'Attach the sticky note to a frame: { id: <frame_item_id> }.',
            properties: { id: { type: 'string' } },
          },
        },
        required: ['board_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/sticky_notes',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'sticky_notes.update',
      class: 'mutation',
      description: 'Update a sticky note (content, style, position, geometry, or parent frame).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          item_id: { type: 'string' },
          data: { type: 'object' },
          style: { type: 'object' },
          position: { type: 'object' },
          geometry: { type: 'object' },
          parent: { type: 'object' },
        },
        required: ['board_id', 'item_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/boards/{board_id}/sticky_notes/{item_id}',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'text.create',
      class: 'mutation',
      description: 'Create a text item on a board.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: { content: { type: 'string' } },
            required: ['content'],
          },
          style: { type: 'object' },
          position: { type: 'object' },
          geometry: { type: 'object' },
          parent: { type: 'object' },
        },
        required: ['board_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/texts',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'shapes.create',
      class: 'mutation',
      description:
        'Create a shape item on a board. `data.shape` selects the geometric primitive (rectangle, round_rectangle, circle, triangle, rhombus, etc.).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              shape: {
                type: 'string',
                description:
                  'Miro shape kind; full enum at https://developers.miro.com/reference/create-shape-item.',
              },
              content: { type: 'string' },
            },
            required: ['shape'],
          },
          style: { type: 'object' },
          position: { type: 'object' },
          geometry: { type: 'object' },
          parent: { type: 'object' },
        },
        required: ['board_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/shapes',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'cards.create',
      class: 'mutation',
      description: 'Create a card item (title + description + assignee + due-date) on a board.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              dueDate: { type: 'string', format: 'date-time' },
              assigneeId: { type: 'string' },
            },
            required: ['title'],
          },
          style: { type: 'object' },
          position: { type: 'object' },
          geometry: { type: 'object' },
          parent: { type: 'object' },
        },
        required: ['board_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/cards',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'frames.create',
      class: 'mutation',
      description:
        'Create a frame on a board. Frames group items; child items can be attached via `parent.id` on item creation.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              format: { type: 'string', enum: ['custom'] },
              type: { type: 'string', enum: ['freeform'] },
            },
          },
          style: { type: 'object' },
          position: { type: 'object' },
          geometry: { type: 'object' },
        },
        required: ['board_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/frames',
        body: {
          data: '{data}',
          style: '{style}',
          position: '{position}',
          geometry: '{geometry}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'images.create.by_url',
      class: 'mutation',
      description: 'Create an image item from a public URL (Miro fetches the image server-side).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri' },
              title: { type: 'string' },
            },
            required: ['url'],
          },
          position: { type: 'object' },
          geometry: { type: 'object' },
          parent: { type: 'object' },
        },
        required: ['board_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/images',
        body: {
          data: '{data}',
          position: '{position}',
          geometry: '{geometry}',
          parent: '{parent}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'connectors.create',
      class: 'mutation',
      description:
        'Create a connector line between two items on the board. `startItem.id` and `endItem.id` reference existing item ids.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          startItem: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          endItem: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          captions: {
            type: 'array',
            items: { type: 'object', properties: { content: { type: 'string' } } },
          },
          style: { type: 'object' },
          shape: { type: 'string', enum: ['straight', 'elbowed', 'curved'] },
        },
        required: ['board_id', 'startItem', 'endItem'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/connectors',
        body: {
          startItem: '{startItem}',
          endItem: '{endItem}',
          captions: '{captions}',
          style: '{style}',
          shape: '{shape}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'items.delete',
      class: 'mutation',
      description: 'Delete an item from a board (works across all item types).',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          item_id: { type: 'string' },
        },
        required: ['board_id', 'item_id'],
      },
      request: { method: 'DELETE', path: '/v2/boards/{board_id}/items/{item_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'boards.share',
      class: 'mutation',
      description:
        'Invite users to a Miro board by email. Roles: viewer, commenter, editor, coowner.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          emails: { type: 'array', items: { type: 'string', format: 'email' } },
          role: {
            type: 'string',
            enum: ['viewer', 'commenter', 'editor', 'coowner'],
          },
          message: { type: 'string' },
        },
        required: ['board_id', 'emails', 'role'],
      },
      request: {
        method: 'POST',
        path: '/v2/boards/{board_id}/members',
        body: {
          emails: '{emails}',
          role: '{role}',
          message: '{message}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
  ],
})
