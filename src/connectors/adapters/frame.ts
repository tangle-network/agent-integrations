import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Frame.io (Adobe) collaborative video-review workspace
 * (https://developer.frame.io). The activepieces catalog entry lists no
 * explicit actions, so the surface below maps the documented v2 REST API
 * (https://api.frame.io/v2): account/team/project navigation, asset CRUD,
 * comments, and review links.
 *
 * Auth is api-key — Frame.io developer tokens are personal-access tokens
 * sent as `Authorization: Bearer <token>`. The catalog records
 * account_id + team_id auth fields so callers can scope subsequent
 * project/asset operations to a single workspace.
 */
export const frameConnector = declarativeRestConnector({
  kind: 'frame',
  displayName: 'Frame.io',
  description:
    'Navigate Frame.io accounts, teams, and projects; manage assets, comments, and review links on the collaborative video-review platform.',
  auth: {
    kind: 'api-key',
    hint: 'Frame.io developer token (https://developer.frame.io). Sent as `Authorization: Bearer <token>`.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.frame.io/v2',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List accounts the authenticated user can access.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/accounts' },
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List teams within an account.',
      parameters: {
        type: 'object',
        properties: { accountId: { type: 'string' } },
        required: ['accountId'],
      },
      request: { method: 'GET', path: '/accounts/{accountId}/teams' },
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List projects within a team.',
      parameters: {
        type: 'object',
        properties: { teamId: { type: 'string' } },
        required: ['teamId'],
      },
      request: { method: 'GET', path: '/teams/{teamId}/projects' },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Fetch a single project by id.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/projects/{projectId}' },
    },
    {
      name: 'assets.list',
      class: 'read',
      description: 'List child assets within a folder (or project root folder).',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['folderId'],
      },
      request: {
        method: 'GET',
        path: '/assets/{folderId}/children',
        query: { page: '{page}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'assets.get',
      class: 'read',
      description: 'Fetch a single asset (file, folder, or version-stack) by id.',
      parameters: {
        type: 'object',
        properties: { assetId: { type: 'string' } },
        required: ['assetId'],
      },
      request: { method: 'GET', path: '/assets/{assetId}' },
    },
    {
      name: 'assets.create',
      class: 'mutation',
      description:
        'Create an asset (folder or file placeholder) under a parent folder. File uploads then PUT to the returned upload_urls.',
      parameters: {
        type: 'object',
        properties: {
          parentAssetId: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['file', 'folder'] },
          filetype: { type: 'string' },
          filesize: { type: 'integer' },
          description: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['parentAssetId', 'name', 'type'],
      },
      request: {
        method: 'POST',
        path: '/assets/{parentAssetId}/children',
        body: {
          name: '{name}',
          type: '{type}',
          filetype: '{filetype}',
          filesize: '{filesize}',
          description: '{description}',
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'assets.update',
      class: 'mutation',
      description: 'Update an asset (rename, move, edit description, etc.).',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['assetId'],
      },
      request: {
        method: 'PUT',
        path: '/assets/{assetId}',
        body: {
          name: '{name}',
          description: '{description}',
          properties: '{properties}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'assets.delete',
      class: 'mutation',
      description: 'Delete an asset by id.',
      parameters: {
        type: 'object',
        properties: { assetId: { type: 'string' } },
        required: ['assetId'],
      },
      request: { method: 'DELETE', path: '/assets/{assetId}' },
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments on an asset.',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['assetId'],
      },
      request: {
        method: 'GET',
        path: '/assets/{assetId}/comments',
        query: { page: '{page}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description:
        'Post a comment on an asset. Use `timestamp` (seconds) or `annotation` payloads for time-coded video review notes.',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          text: { type: 'string' },
          timestamp: { type: 'number' },
          annotation: { type: 'string' },
          pitched: { type: 'boolean' },
        },
        required: ['assetId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/assets/{assetId}/comments',
        body: {
          text: '{text}',
          timestamp: '{timestamp}',
          annotation: '{annotation}',
          pitched: '{pitched}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.update',
      class: 'mutation',
      description: 'Edit a comment by id.',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
          text: { type: 'string' },
          completed: { type: 'boolean' },
        },
        required: ['commentId'],
      },
      request: {
        method: 'PUT',
        path: '/comments/{commentId}',
        body: { text: '{text}', completed: '{completed}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'reviewLinks.list',
      class: 'read',
      description: 'List review links for a project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/projects/{projectId}/review_links' },
    },
    {
      name: 'reviewLinks.create',
      class: 'mutation',
      description: 'Create a shareable review link inside a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          password: { type: 'string' },
          allowApproval: { type: 'boolean' },
          enableDownloading: { type: 'boolean' },
          expiresAt: { type: 'string' },
        },
        required: ['projectId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/review_links',
        body: {
          name: '{name}',
          password: '{password}',
          allow_approval: '{allowApproval}',
          enable_downloading: '{enableDownloading}',
          expires_at: '{expiresAt}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
