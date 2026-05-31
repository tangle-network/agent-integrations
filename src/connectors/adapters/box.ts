import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Box Content Cloud connector — standard OAuth2 with refresh tokens.
 *
 * Box's OAuth2 flow is the textbook RFC 6749 authorization-code grant:
 *   - authorize at https://account.box.com/api/oauth2/authorize
 *   - exchange at https://api.box.com/oauth2/token
 *   - refresh at the same /oauth2/token endpoint
 *
 * Access tokens live 60 minutes; refresh tokens live 60 days and rotate on
 * every refresh — callers must persist the new refresh_token on each
 * exchange (the declarative adapter handles refresh through the shared
 * oauth helpers, so the only contract here is the manifest URLs + scopes).
 *
 * Scope surface picked to cover the dominant "agent reads / files / folders
 * and uploads or moves an item" pattern without pulling in the admin
 * surfaces. `root_readwrite` is Box's coarse-grained app-folder scope; we
 * keep it off the default list — adapters that want write access must
 * request it explicitly via `requiredScopes` on the mutation capabilities.
 *
 * Action surface:
 *   - folders.get        Read folder metadata + first page of items.
 *   - folders.items      Paginated child enumeration with limit/offset.
 *   - folders.create     Create a folder under a parent.
 *   - files.get          Read file metadata (size, sha1, parent, version).
 *   - files.update       Rename / move / restore-from-trash a file.
 *   - files.copy         Server-side copy into a target folder.
 *   - files.delete       Send a file to trash.
 *   - search             Full-text + metadata search across the enterprise.
 *   - users.me           Self-test endpoint (also exposed as `test`).
 *
 * Box does not implement ETag-style preconditions on every endpoint, but
 * file/folder PUTs honor `If-Match` against the resource `etag` field;
 * mutations are flagged `optimistic-read-verify` so the action guard
 * round-trips the read before write. Creates use `native-idempotency`
 * since Box derives uniqueness from (parent_id, name) and 409s on
 * collisions, which the declarative layer surfaces as
 * `{ status: 'conflict' }`.
 */
export const boxConnector = declarativeRestConnector({
  kind: 'box',
  displayName: 'Box',
  description:
    'Read, write, and search files and folders in a Box Content Cloud account. Standard OAuth2 with rotating refresh tokens; targets the v2.0 REST API at api.box.com.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    scopes: ['root_readonly'],
    clientIdEnv: 'BOX_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BOX_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  // Box pins the version in the path (/2.0/...) and the declarative
  // base-url joiner treats a leading-slash path as absolute, so we keep
  // the version segment on every path rather than on the base.
  baseUrl: 'https://api.box.com',
  test: { method: 'GET', path: '/2.0/users/me' },
  capabilities: [
    {
      name: 'users.me',
      class: 'read',
      description: 'Read the currently authenticated Box user (used for connection self-test).',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'string',
            description: 'Comma-separated subset of user fields to return (e.g. "id,login,name,enterprise").',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/2.0/users/me',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['root_readonly'],
    },
    {
      name: 'folders.get',
      class: 'read',
      description:
        'Read folder metadata and the first page of child items. The root folder of every Box account has id "0".',
      parameters: {
        type: 'object',
        properties: {
          folderId: {
            type: 'string',
            description: 'Box folder id. Use "0" for the account root.',
          },
          fields: { type: 'string', description: 'Comma-separated subset of folder fields.' },
        },
        required: ['folderId'],
      },
      request: {
        method: 'GET',
        path: '/2.0/folders/{folderId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['root_readonly'],
    },
    {
      name: 'folders.items',
      class: 'read',
      description:
        'List the children of a folder with limit/offset pagination. Returns mixed files, folders, and weblinks; inspect each entry\'s `type` field.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Box folder id; "0" is the account root.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: {
            type: 'string',
            enum: ['id', 'name', 'date'],
            description: 'Sort key; Box defaults to "name".',
          },
          direction: { type: 'string', enum: ['ASC', 'DESC'] },
          fields: { type: 'string', description: 'Comma-separated item fields to return.' },
        },
        required: ['folderId'],
      },
      request: {
        method: 'GET',
        path: '/2.0/folders/{folderId}/items',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          sort: '{sort}',
          direction: '{direction}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['root_readonly'],
    },
    {
      name: 'folders.create',
      class: 'mutation',
      description:
        'Create a folder under a parent. Box rejects duplicate (parent_id, name) with 409 conflict; the declarative layer surfaces those as { status: "conflict" }.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'New folder name; 1-255 chars, no leading/trailing whitespace.' },
          parent: {
            type: 'object',
            description: 'Reference to the destination folder.',
            properties: { id: { type: 'string', description: 'Parent folder id; "0" is the root.' } },
            required: ['id'],
          },
        },
        required: ['name', 'parent'],
      },
      request: { method: 'POST', path: '/2.0/folders', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['root_readwrite'],
    },
    {
      name: 'files.get',
      class: 'read',
      description:
        'Read file metadata (size, sha1, parent, modified_at, version, etag). Does NOT return the file contents — use the Box download URL flow for that.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Box file id.' },
          fields: { type: 'string' },
        },
        required: ['fileId'],
      },
      request: {
        method: 'GET',
        path: '/2.0/files/{fileId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['root_readonly'],
    },
    {
      name: 'files.update',
      class: 'mutation',
      description:
        'Rename, move (change parent), or restore-from-trash a file. Pass any subset of {name, parent, description, tags, shared_link} as fields. Honors If-Match against the file etag for optimistic concurrency.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          fields: {
            type: 'object',
            description: 'Partial file payload; e.g. { "name": "Report-v2.pdf", "parent": { "id": "12345" } }.',
          },
        },
        required: ['fileId', 'fields'],
      },
      request: { method: 'PUT', path: '/2.0/files/{fileId}', body: '{fields}' },
      cas: 'etag-if-match',
      requiredScopes: ['root_readwrite'],
    },
    {
      name: 'files.copy',
      class: 'mutation',
      description:
        'Server-side copy a file into a destination folder. Optional `name` for renaming on copy; Box 409s on duplicate (parent, name).',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          parent: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          name: { type: 'string' },
          version: { type: 'string', description: 'Optional file version id to copy from (defaults to current).' },
        },
        required: ['fileId', 'parent'],
      },
      request: {
        method: 'POST',
        path: '/2.0/files/{fileId}/copy',
        body: { parent: '{parent}', name: '{name}', version: '{version}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['root_readwrite'],
    },
    {
      name: 'files.delete',
      class: 'mutation',
      description:
        'Send a file to trash. Box keeps trashed files for 30 days by default (enterprise-configurable). Honors If-Match against the file etag.',
      parameters: {
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      },
      request: { method: 'DELETE', path: '/2.0/files/{fileId}' },
      cas: 'etag-if-match',
      requiredScopes: ['root_readwrite'],
    },
    {
      name: 'folders.delete',
      class: 'mutation',
      description:
        'Send a folder to trash. Pass recursive=true to delete a non-empty folder; otherwise Box rejects with 400.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          recursive: { type: 'boolean', default: false },
        },
        required: ['folderId'],
      },
      request: {
        method: 'DELETE',
        path: '/2.0/folders/{folderId}',
        query: { recursive: '{recursive}' },
      },
      cas: 'etag-if-match',
      requiredScopes: ['root_readwrite'],
    },
    {
      name: 'search',
      class: 'read',
      description:
        'Full-text + metadata search across the enterprise. Filters by type (file|folder|web_link), file_extensions, ancestor_folder_ids, content_types, and created_at_range / updated_at_range (ISO-8601, comma-joined).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search query.' },
          type: { type: 'string', enum: ['file', 'folder', 'web_link'] },
          file_extensions: {
            type: 'string',
            description: 'Comma-separated list of extensions WITHOUT dot, e.g. "pdf,docx".',
          },
          ancestor_folder_ids: {
            type: 'string',
            description: 'Comma-separated folder ids to scope the search to.',
          },
          content_types: {
            type: 'string',
            description: 'Comma-separated list of content fields to match, e.g. "name,description,file_content".',
          },
          created_at_range: { type: 'string', description: 'ISO8601 range "from,to".' },
          updated_at_range: { type: 'string', description: 'ISO8601 range "from,to".' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/2.0/search',
        query: {
          query: '{query}',
          type: '{type}',
          file_extensions: '{file_extensions}',
          ancestor_folder_ids: '{ancestor_folder_ids}',
          content_types: '{content_types}',
          created_at_range: '{created_at_range}',
          updated_at_range: '{updated_at_range}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['root_readonly'],
    },
    {
      name: 'collaborations.create',
      class: 'mutation',
      description:
        'Share a file or folder with a Box user (by id or login email) at a given role. Box dedupes (item, accessible_by) pairs.',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['file', 'folder'] },
            },
            required: ['id', 'type'],
          },
          accessible_by: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Box user/group id (mutually exclusive with login).' },
              login: { type: 'string', description: 'Email login of the target user.' },
              type: { type: 'string', enum: ['user', 'group'] },
            },
            required: ['type'],
          },
          role: {
            type: 'string',
            enum: [
              'editor',
              'viewer',
              'previewer',
              'uploader',
              'previewer uploader',
              'viewer uploader',
              'co-owner',
              'owner',
            ],
          },
        },
        required: ['item', 'accessible_by', 'role'],
      },
      request: { method: 'POST', path: '/2.0/collaborations', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['root_readwrite'],
    },
  ],
})
