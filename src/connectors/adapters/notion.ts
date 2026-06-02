import { declarativeRestConnector } from './declarative-rest.js'

export const notionConnector = declarativeRestConnector({
  kind: 'notion',
  displayName: 'Notion',
  description: 'Query and manipulate Notion databases, pages, and blocks.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.notion.com/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'NOTION_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NOTION_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.notion.com/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'databases.retrieve',
      class: 'read',
      description: 'Retrieve a Notion database.',
      parameters: {
        type: 'object',
        properties: { databaseId: { type: 'string' } },
        required: ['databaseId'],
      },
      request: { method: 'GET', path: '/databases/{databaseId}' },
    },
    {
      name: 'databases.query',
      class: 'read',
      description: 'Query a Notion database with filters and sorting.',
      parameters: {
        type: 'object',
        properties: {
          databaseId: { type: 'string' },
          filter: { type: 'object' },
          sorts: { type: 'array' },
          pageSize: { type: 'integer' },
        },
        required: ['databaseId'],
      },
      request: {
        method: 'POST',
        path: '/databases/{databaseId}/query',
        body: { filter: '{filter}', sorts: '{sorts}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description: 'Create a new Notion page.',
      parameters: {
        type: 'object',
        properties: {
          parentDatabaseId: { type: 'string' },
          title: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['parentDatabaseId', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/pages',
        body: {
          parent: { database_id: '{parentDatabaseId}' },
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.retrieve',
      class: 'read',
      description: 'Retrieve a Notion page.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' } },
        required: ['pageId'],
      },
      request: { method: 'GET', path: '/pages/{pageId}' },
    },
    {
      name: 'pages.update',
      class: 'mutation',
      description: 'Update a Notion page properties.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' }, properties: { type: 'object' } },
        required: ['pageId', 'properties'],
      },
      request: {
        method: 'PATCH',
        path: '/pages/{pageId}',
        body: { properties: '{properties}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'pages.archive',
      class: 'mutation',
      description: 'Archive a Notion page.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' } },
        required: ['pageId'],
      },
      request: {
        method: 'PATCH',
        path: '/pages/{pageId}',
        body: { archived: true },
      },
    },
    {
      name: 'blocks.retrieve',
      class: 'read',
      description: 'Retrieve a Notion block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' } },
        required: ['blockId'],
      },
      request: { method: 'GET', path: '/blocks/{blockId}' },
    },
    {
      name: 'blocks.children',
      class: 'read',
      description: 'Retrieve all children blocks of a block or page.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, pageSize: { type: 'integer' } },
        required: ['blockId'],
      },
      request: {
        method: 'GET',
        path: '/blocks/{blockId}/children',
        query: { page_size: '{pageSize}' },
      },
    },
    {
      name: 'blocks.append',
      class: 'mutation',
      description: 'Append blocks as children of a page or block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, children: { type: 'array' } },
        required: ['blockId', 'children'],
      },
      request: {
        method: 'PATCH',
        path: '/blocks/{blockId}/children',
        body: { children: '{children}' },
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Add a comment to a page or block.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          richText: { type: 'array' },
        },
        required: ['blockId', 'richText'],
      },
      request: {
        method: 'POST',
        path: '/comments',
        body: {
          block_id: '{blockId}',
          rich_text: '{richText}',
        },
      },
    },
    {
      name: 'comments.retrieve',
      class: 'read',
      description: 'Retrieve comments on a block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, pageSize: { type: 'integer' } },
        required: ['blockId'],
      },
      request: {
        method: 'GET',
        path: '/comments',
        query: { block_id: '{blockId}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List users in the connected Notion workspace.',
      parameters: {
        type: 'object',
        properties: {
          startCursor: { type: 'string', description: 'Pagination cursor returned by a prior call.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { start_cursor: '{startCursor}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'blocks.update',
      class: 'mutation',
      description:
        'Update an existing Notion block. `content` carries the type-specific fields (e.g. { paragraph: { rich_text: [...] } }) Notion expects.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          content: {
            type: 'object',
            description: 'Block content patch (type-specific fields keyed by block type).',
          },
        },
        required: ['blockId', 'content'],
      },
      request: {
        method: 'PATCH',
        path: '/blocks/{blockId}',
        body: '{content}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'blocks.delete',
      class: 'mutation',
      description: 'Delete a Notion block (moves it to trash).',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' } },
        required: ['blockId'],
      },
      request: {
        method: 'DELETE',
        path: '/blocks/{blockId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
