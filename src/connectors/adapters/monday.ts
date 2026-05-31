import { declarativeRestConnector } from './declarative-rest.js'

// monday.com exposes a single GraphQL endpoint at https://api.monday.com/v2.
// We follow the same approach the Linear adapter uses: each high-level
// capability is modeled as a POST to /v2 with a fixed query string and a
// templated `variables` payload. The declarative-REST runtime substitutes the
// `variables` object verbatim, which matches monday's documented variable
// shapes (ColumnValues, ItemCreateInput, etc.) without reflattening them into
// REST-style parameters.
//
// OAuth + scope reference: https://developer.monday.com/apps/docs/oauth
// GraphQL API reference:   https://developer.monday.com/api-reference/docs

const BOARD_FRAGMENT = `
  id
  name
  description
  state
  board_kind
  workspace { id name kind }
  permissions
  updated_at
`

const COLUMN_FRAGMENT = `
  id
  title
  type
  settings_str
  description
`

const GROUP_FRAGMENT = `
  id
  title
  color
  position
  archived
`

const ITEM_FRAGMENT = `
  id
  name
  state
  created_at
  updated_at
  creator_id
  board { id name }
  group { id title }
  column_values {
    id
    type
    text
    value
  }
`

const UPDATE_FRAGMENT = `
  id
  body
  text_body
  created_at
  creator_id
  item_id
`

const ME_QUERY = 'query Me { me { id name email is_admin is_guest enabled url } }'

const BOARDS_LIST_QUERY = `query Boards($limit: Int, $page: Int, $ids: [ID!], $workspace_ids: [ID!], $board_kind: BoardKind, $state: State) {
  boards(limit: $limit, page: $page, ids: $ids, workspace_ids: $workspace_ids, board_kind: $board_kind, state: $state) {${BOARD_FRAGMENT}
    groups {${GROUP_FRAGMENT}}
    columns {${COLUMN_FRAGMENT}}
  }
}`

const BOARD_GET_QUERY = `query BoardGet($ids: [ID!]) {
  boards(ids: $ids) {${BOARD_FRAGMENT}
    groups {${GROUP_FRAGMENT}}
    columns {${COLUMN_FRAGMENT}}
  }
}`

const ITEMS_PAGE_QUERY = `query ItemsPage($boardId: ID!, $limit: Int, $cursor: String, $query_params: ItemsQuery) {
  boards(ids: [$boardId]) {
    id
    items_page(limit: $limit, cursor: $cursor, query_params: $query_params) {
      cursor
      items {${ITEM_FRAGMENT}}
    }
  }
}`

const ITEM_GET_QUERY = `query ItemGet($ids: [ID!]) { items(ids: $ids) {${ITEM_FRAGMENT}} }`

const ITEM_CREATE_MUTATION = `mutation ItemCreate($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON, $create_labels_if_missing: Boolean) {
  create_item(
    board_id: $board_id
    item_name: $item_name
    group_id: $group_id
    column_values: $column_values
    create_labels_if_missing: $create_labels_if_missing
  ) {${ITEM_FRAGMENT}}
}`

const ITEM_UPDATE_MUTATION = `mutation ItemColumnValuesUpdate($board_id: ID!, $item_id: ID!, $column_values: JSON!, $create_labels_if_missing: Boolean) {
  change_multiple_column_values(
    board_id: $board_id
    item_id: $item_id
    column_values: $column_values
    create_labels_if_missing: $create_labels_if_missing
  ) {${ITEM_FRAGMENT}}
}`

const ITEM_ARCHIVE_MUTATION = `mutation ItemArchive($item_id: ID!) {
  archive_item(item_id: $item_id) { id state }
}`

const ITEM_DELETE_MUTATION = `mutation ItemDelete($item_id: ID!) {
  delete_item(item_id: $item_id) { id }
}`

const ITEM_MOVE_GROUP_MUTATION = `mutation ItemMoveGroup($item_id: ID!, $group_id: String!) {
  move_item_to_group(item_id: $item_id, group_id: $group_id) {${ITEM_FRAGMENT}}
}`

const GROUP_CREATE_MUTATION = `mutation GroupCreate($board_id: ID!, $group_name: String!, $position: String) {
  create_group(board_id: $board_id, group_name: $group_name, position: $position) {${GROUP_FRAGMENT}}
}`

const UPDATE_CREATE_MUTATION = `mutation UpdateCreate($item_id: ID!, $body: String!, $parent_id: ID) {
  create_update(item_id: $item_id, body: $body, parent_id: $parent_id) {${UPDATE_FRAGMENT}}
}`

const UPDATES_LIST_QUERY = `query UpdatesList($limit: Int, $page: Int, $item_id: ID) {
  updates(limit: $limit, page: $page, item_id: $item_id) {${UPDATE_FRAGMENT}}
}`

const WORKSPACES_LIST_QUERY = `query WorkspacesList($limit: Int, $page: Int, $kind: WorkspaceKind, $state: State) {
  workspaces(limit: $limit, page: $page, kind: $kind, state: $state) {
    id
    name
    kind
    description
    state
    created_at
  }
}`

export const mondayConnector = declarativeRestConnector({
  kind: 'monday',
  displayName: 'monday.com',
  description: 'Query and mutate monday.com boards, items, groups, and updates over the GraphQL v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://auth.monday.com/oauth2/authorize',
    tokenUrl: 'https://auth.monday.com/oauth2/token',
    scopes: [
      'me:read',
      'boards:read',
      'boards:write',
      'workspaces:read',
      'users:read',
      'updates:read',
      'updates:write',
      'assets:read',
      'tags:read',
      'notifications:write',
    ],
    clientIdEnv: 'MONDAY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MONDAY_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.monday.com',
  defaultHeaders: {
    'api-version': '2024-10',
  },
  test: {
    method: 'POST',
    path: '/v2',
    body: { query: ME_QUERY },
  },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Return the authenticated monday.com account holder.',
      parameters: { type: 'object', properties: {} },
      request: {
        method: 'POST',
        path: '/v2',
        body: { query: ME_QUERY },
      },
      requiredScopes: ['me:read'],
    },
    {
      name: 'workspaces.list',
      class: 'read',
      description: 'List workspaces the connected account can access.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
          kind: { type: 'string', enum: ['open', 'closed'] },
          state: { type: 'string', enum: ['active', 'archived', 'deleted', 'all'] },
        },
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: WORKSPACES_LIST_QUERY,
          variables: {
            limit: '{limit}',
            page: '{page}',
            kind: '{kind}',
            state: '{state}',
          },
        },
      },
      requiredScopes: ['workspaces:read'],
    },
    {
      name: 'boards.list',
      class: 'read',
      description: 'List boards the connected account can read, optionally filtered by workspace, kind, or state.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
          ids: { type: 'array', items: { type: 'string' } },
          workspace_ids: { type: 'array', items: { type: 'string' } },
          board_kind: { type: 'string', enum: ['public', 'private', 'share'] },
          state: { type: 'string', enum: ['active', 'archived', 'deleted', 'all'] },
        },
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: BOARDS_LIST_QUERY,
          variables: {
            limit: '{limit}',
            page: '{page}',
            ids: '{ids}',
            workspace_ids: '{workspace_ids}',
            board_kind: '{board_kind}',
            state: '{state}',
          },
        },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'boards.get',
      class: 'read',
      description: 'Fetch boards by id, including their groups and columns.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['ids'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: BOARD_GET_QUERY,
          variables: { ids: '{ids}' },
        },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'items.page',
      class: 'read',
      description: 'Paginate items on a board using monday.com items_page cursor semantics.',
      parameters: {
        type: 'object',
        properties: {
          boardId: { type: 'string', description: 'Numeric board id as a string.' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          cursor: { type: 'string', description: 'Opaque cursor returned by a previous items_page call.' },
          query_params: {
            type: 'object',
            description: 'ItemsQuery filter (rules, operator, order_by), per monday.com schema.',
          },
        },
        required: ['boardId'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEMS_PAGE_QUERY,
          variables: {
            boardId: '{boardId}',
            limit: '{limit}',
            cursor: '{cursor}',
            query_params: '{query_params}',
          },
        },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'items.get',
      class: 'read',
      description: 'Fetch items by id with full column values.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['ids'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_GET_QUERY,
          variables: { ids: '{ids}' },
        },
      },
      requiredScopes: ['boards:read'],
    },
    {
      name: 'updates.list',
      class: 'read',
      description: 'List updates (comments) optionally scoped to a single item.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'Item id to scope to. Omit for a global feed.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
        },
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: UPDATES_LIST_QUERY,
          variables: {
            item_id: '{item_id}',
            limit: '{limit}',
            page: '{page}',
          },
        },
      },
      requiredScopes: ['updates:read'],
    },
    {
      name: 'items.create',
      class: 'mutation',
      description: 'Create a new item on a board. column_values is a JSON map of column id → value, per monday.com column schema.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          item_name: { type: 'string' },
          group_id: { type: 'string' },
          column_values: {
            type: 'object',
            description: 'Column id → value map. monday accepts this as a JSON-encoded string; the runtime serializes it.',
          },
          create_labels_if_missing: { type: 'boolean' },
        },
        required: ['board_id', 'item_name'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_CREATE_MUTATION,
          variables: {
            board_id: '{board_id}',
            item_name: '{item_name}',
            group_id: '{group_id}',
            column_values: '{column_values}',
            create_labels_if_missing: '{create_labels_if_missing}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'items.update_columns',
      class: 'mutation',
      description: 'Change multiple column values on an existing item in a single call.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          item_id: { type: 'string' },
          column_values: { type: 'object', description: 'Column id → new value map.' },
          create_labels_if_missing: { type: 'boolean' },
        },
        required: ['board_id', 'item_id', 'column_values'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_UPDATE_MUTATION,
          variables: {
            board_id: '{board_id}',
            item_id: '{item_id}',
            column_values: '{column_values}',
            create_labels_if_missing: '{create_labels_if_missing}',
          },
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'items.move_group',
      class: 'mutation',
      description: 'Move an item from its current group into the target group on the same board.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string' },
          group_id: { type: 'string' },
        },
        required: ['item_id', 'group_id'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_MOVE_GROUP_MUTATION,
          variables: {
            item_id: '{item_id}',
            group_id: '{group_id}',
          },
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'items.archive',
      class: 'mutation',
      description: 'Archive an item (recoverable, item remains in the board archive).',
      parameters: {
        type: 'object',
        properties: { item_id: { type: 'string' } },
        required: ['item_id'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_ARCHIVE_MUTATION,
          variables: { item_id: '{item_id}' },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'items.delete',
      class: 'mutation',
      description: 'Permanently delete an item from a board.',
      parameters: {
        type: 'object',
        properties: { item_id: { type: 'string' } },
        required: ['item_id'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: ITEM_DELETE_MUTATION,
          variables: { item_id: '{item_id}' },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'groups.create',
      class: 'mutation',
      description: 'Create a new group on a board, optionally positioned at top or bottom.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string' },
          group_name: { type: 'string' },
          position: { type: 'string', description: 'before_all | after_all | <group_id> per monday schema.' },
        },
        required: ['board_id', 'group_name'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: GROUP_CREATE_MUTATION,
          variables: {
            board_id: '{board_id}',
            group_name: '{group_name}',
            position: '{position}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['boards:write'],
    },
    {
      name: 'updates.create',
      class: 'mutation',
      description: 'Post an update (comment) on an item, optionally as a reply to a parent update.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string' },
          body: { type: 'string', description: 'Update body. monday accepts a subset of HTML for rich text.' },
          parent_id: { type: 'string', description: 'Parent update id when replying to a thread.' },
        },
        required: ['item_id', 'body'],
      },
      request: {
        method: 'POST',
        path: '/v2',
        body: {
          query: UPDATE_CREATE_MUTATION,
          variables: {
            item_id: '{item_id}',
            body: '{body}',
            parent_id: '{parent_id}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['updates:write'],
    },
  ],
})
