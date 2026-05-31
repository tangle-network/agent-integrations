import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft SharePoint connector backed by Microsoft Graph v1.0.
 *
 * Sites, drives, list items, files, and pages are surfaced through
 * `https://graph.microsoft.com/v1.0/sites/...`. OAuth2 against the v2.0
 * Microsoft identity platform endpoint uses the multi-tenant `common`
 * authority by default; single-tenant deployments override
 * authorizationUrl/tokenUrl with their own tenant id.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/sharepoint
 *   - https://learn.microsoft.com/graph/api/resources/driveitem
 *   - https://learn.microsoft.com/graph/api/resources/listitem
 *   - https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow
 *
 * Mapped activepieces piece: microsoft-sharepoint (storage / oauth2).
 */
export const microsoftSharepointConnector = declarativeRestConnector({
  kind: 'microsoft-sharepoint',
  displayName: 'Microsoft SharePoint',
  description:
    'Read SharePoint site metadata, list items, and files; create folders, lists, list items, and pages via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'Sites.ReadWrite.All',
      'Files.ReadWrite.All',
    ],
    clientIdEnv: 'MICROSOFT_SHAREPOINT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_SHAREPOINT_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/sites/root' },
  capabilities: [
    // ---------- Sites ----------
    {
      name: 'find.site',
      class: 'read',
      description: 'Search SharePoint sites by display name or keyword (Graph $search).',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          $top: { type: 'integer' },
        },
        required: ['search'],
      },
      request: {
        method: 'GET',
        path: '/sites',
        query: { search: '{search}', $top: '{$top}' },
      },
      requiredScopes: ['Sites.ReadWrite.All'],
    },
    {
      name: 'get.site.information',
      class: 'read',
      description: 'Read the metadata for a SharePoint site by site id.',
      parameters: {
        type: 'object',
        properties: { siteId: { type: 'string' } },
        required: ['siteId'],
      },
      request: { method: 'GET', path: '/sites/{siteId}' },
      requiredScopes: ['Sites.ReadWrite.All'],
    },

    // ---------- Folders / files ----------
    {
      name: 'create.folder',
      class: 'mutation',
      description:
        'Create a folder inside a site drive. Parent is identified by its drive item id (use the drive root id for top-level folders).',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          parentItemId: { type: 'string' },
          name: { type: 'string' },
          conflictBehavior: { type: 'string' },
        },
        required: ['siteId', 'parentItemId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/drive/items/{parentItemId}/children',
        body: {
          name: '{name}',
          folder: {},
          '@microsoft.graph.conflictBehavior': '{conflictBehavior}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'get.folder.contents',
      class: 'read',
      description: 'List the children of a folder in a site drive.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          itemId: { type: 'string' },
          $top: { type: 'integer' },
          $select: { type: 'string' },
        },
        required: ['siteId', 'itemId'],
      },
      request: {
        method: 'GET',
        path: '/sites/{siteId}/drive/items/{itemId}/children',
        query: { $top: '{$top}', $select: '{$select}' },
      },
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'find.file',
      class: 'read',
      description: 'Search drive items inside a site drive by name or content (Graph drive search).',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          query: { type: 'string' },
          $top: { type: 'integer' },
        },
        required: ['siteId', 'query'],
      },
      request: {
        method: 'GET',
        path: "/sites/{siteId}/drive/root/search(q='{query}')",
        query: { $top: '{$top}' },
      },
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'upload.file',
      class: 'mutation',
      description:
        'Upload (or replace) a small file at the given drive path. The body must be the JSON-encoded contents the agent provides as `content` (base64-encoded for binary payloads). For files larger than 4 MiB the caller should use the upload-session flow instead.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          parentItemId: { type: 'string' },
          fileName: { type: 'string' },
          content: { type: 'string' },
          conflictBehavior: { type: 'string' },
        },
        required: ['siteId', 'parentItemId', 'fileName', 'content'],
      },
      request: {
        method: 'PUT',
        path: '/sites/{siteId}/drive/items/{parentItemId}:/{fileName}:/content',
        body: '{content}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'copy.item',
      class: 'mutation',
      description:
        'Copy a drive item into another drive. The destination is identified by a parentReference (driveId + id) and an optional new name.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          itemId: { type: 'string' },
          parentReference: { type: 'object' },
          name: { type: 'string' },
        },
        required: ['siteId', 'itemId', 'parentReference'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/drive/items/{itemId}/copy',
        body: { parentReference: '{parentReference}', name: '{name}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'copy.item.within.site',
      class: 'mutation',
      description:
        'Copy a drive item to another folder inside the same site drive. The destination parent is identified by the target folder id.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          itemId: { type: 'string' },
          targetParentId: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['siteId', 'itemId', 'targetParentId'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/drive/items/{itemId}/copy',
        body: { parentReference: { id: '{targetParentId}' }, name: '{name}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },
    {
      name: 'move.file',
      class: 'mutation',
      description:
        'Move (re-parent or rename) a drive item by patching its parentReference and/or name.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          itemId: { type: 'string' },
          parentReference: { type: 'object' },
          name: { type: 'string' },
        },
        required: ['siteId', 'itemId', 'parentReference'],
      },
      request: {
        method: 'PATCH',
        path: '/sites/{siteId}/drive/items/{itemId}',
        body: { parentReference: '{parentReference}', name: '{name}' },
      },
      cas: 'etag-if-match',
      requiredScopes: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'],
    },

    // ---------- Lists & list items ----------
    {
      name: 'create.list',
      class: 'mutation',
      description:
        'Create a SharePoint list on the site. `displayName` is required; `columns` and `list.template` are optional.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          displayName: { type: 'string' },
          columns: { type: 'array', items: { type: 'object' } },
          list: { type: 'object' },
        },
        required: ['siteId', 'displayName'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/lists',
        body: { displayName: '{displayName}', columns: '{columns}', list: '{list}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Sites.ReadWrite.All'],
    },
    {
      name: 'create.list.item',
      class: 'mutation',
      description: 'Create a new list item. `fields` is the column -> value map.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          listId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['siteId', 'listId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/lists/{listId}/items',
        body: { fields: '{fields}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Sites.ReadWrite.All'],
    },
    {
      name: 'update.list.item',
      class: 'mutation',
      description: 'Patch the fields on an existing list item.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          listId: { type: 'string' },
          itemId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['siteId', 'listId', 'itemId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/sites/{siteId}/lists/{listId}/items/{itemId}/fields',
        body: '{fields}',
      },
      cas: 'etag-if-match',
      requiredScopes: ['Sites.ReadWrite.All'],
    },
    {
      name: 'delete.list.item',
      class: 'mutation',
      description: 'Delete a list item by id.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          listId: { type: 'string' },
          itemId: { type: 'string' },
        },
        required: ['siteId', 'listId', 'itemId'],
      },
      request: {
        method: 'DELETE',
        path: '/sites/{siteId}/lists/{listId}/items/{itemId}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['Sites.ReadWrite.All'],
    },
    {
      name: 'find.list.item',
      class: 'read',
      description:
        'List items in a SharePoint list, optionally filtered with $filter / $expand=fields($select=...).',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          listId: { type: 'string' },
          $filter: { type: 'string' },
          $expand: { type: 'string' },
          $top: { type: 'integer' },
        },
        required: ['siteId', 'listId'],
      },
      request: {
        method: 'GET',
        path: '/sites/{siteId}/lists/{listId}/items',
        query: { $filter: '{$filter}', $expand: '{$expand}', $top: '{$top}' },
      },
      requiredScopes: ['Sites.ReadWrite.All'],
    },

    // ---------- Pages ----------
    {
      name: 'publish.page',
      class: 'mutation',
      description: 'Publish a SharePoint site page by page id.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          pageId: { type: 'string' },
        },
        required: ['siteId', 'pageId'],
      },
      request: {
        method: 'POST',
        path: '/sites/{siteId}/pages/{pageId}/microsoft.graph.sitePage/publish',
      },
      cas: 'native-idempotency',
      requiredScopes: ['Sites.ReadWrite.All'],
    },
  ],
})
