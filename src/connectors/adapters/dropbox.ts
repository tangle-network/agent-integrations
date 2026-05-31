import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Dropbox connector — standard OAuth2 against the Dropbox v2 RPC API.
 *
 * OAuth2 endpoints:
 *   - authorize at https://www.dropbox.com/oauth2/authorize
 *   - exchange / refresh at https://api.dropboxapi.com/oauth2/token
 *
 * Dropbox issues short-lived access tokens (4h) and long-lived refresh
 * tokens when the authorization request is made with
 * `token_access_type=offline`. The refresh tokens do NOT rotate per use
 * (unlike Box), so the declarative adapter only needs to swap the access
 * token through the shared OAuth helpers when 401s land — the manifest
 * here just declares the contract.
 *
 * The Dropbox API is RPC-shaped (POST + JSON body) on api.dropboxapi.com
 * for metadata operations; content upload/download lives on
 * content.dropboxapi.com with the request payload tunneled through the
 * `Dropbox-API-Arg` HTTP header. Because the declarative-REST adapter
 * carries a single base URL and a JSON body, we keep this connector to
 * the metadata + sharing surface — file content upload/download belongs
 * in a content-stream-aware adapter, not here. That keeps every action
 * on this adapter pure JSON-RPC with predictable error handling.
 *
 * Scope surface picked to match a typical "agent enumerates / searches /
 * organizes / shares files" pattern. Read scopes are on the default
 * authorization list; write/share scopes are pulled in per-capability so
 * the action guard's least-privilege check stays meaningful.
 *
 * Action surface:
 *   - users.get_current_account   Self-test endpoint (also exposed as `test`).
 *   - users.get_space_usage       Account quota + used bytes.
 *   - files.list_folder           List the children of a folder path.
 *   - files.list_folder_continue  Cursor-based pagination of list_folder.
 *   - files.get_metadata          Read metadata for a single path.
 *   - files.search                Indexed full-text + filename search.
 *   - files.create_folder_v2      Create a folder at a path.
 *   - files.move_v2               Move / rename a file or folder.
 *   - files.copy_v2               Server-side copy.
 *   - files.delete_v2             Move to deleted/trash state.
 *   - sharing.create_shared_link_with_settings
 *                                 Mint a public shared link with options.
 *   - sharing.list_shared_links   List existing shared links for a path.
 *
 * Dropbox's RPC endpoints are not ETag-shaped — most mutations key off
 * the (parent, name) tuple or accept a `rev` for optimistic writes. The
 * adapter marks creates / copies as `native-idempotency` (Dropbox 409s
 * on duplicate paths with a structured `path/conflict/...` error) and
 * destructive moves/deletes as `optimistic-read-verify` so the action
 * guard round-trips a metadata read before issuing the mutation.
 *
 * Every Dropbox v2 endpoint is `POST`; "read" vs "mutation" here is
 * about side-effect intent, not HTTP verb. `files.list_folder`,
 * `files.search`, and `users.*` are stateless reads that just happen to
 * be POSTed with a JSON arg body, which is the canonical Dropbox shape.
 */
export const dropboxConnector = declarativeRestConnector({
  kind: 'dropbox',
  displayName: 'Dropbox',
  description:
    'Read, organize, search, and share files in a Dropbox account. Standard OAuth2 with refresh tokens against the Dropbox v2 RPC API at api.dropboxapi.com.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['account_info.read', 'files.metadata.read', 'sharing.read'],
    clientIdEnv: 'DROPBOX_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.dropboxapi.com',
  // Dropbox RPC endpoints take a JSON body even for "no-arg" calls; some
  // (like users/get_current_account) accept null and 400 on an empty body.
  // We send `{}` for those by routing them through the args body and
  // letting the schema's lack of required props mean the args object is
  // already `{}` at the wire.
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'POST', path: '/2/users/get_current_account', body: 'args' },
  capabilities: [
    {
      name: 'users.get_current_account',
      class: 'read',
      description:
        'Read the currently authenticated Dropbox account (used for connection self-test). Returns account_id, email, name, country, and team membership when applicable.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'POST', path: '/2/users/get_current_account', body: 'args' },
      requiredScopes: ['account_info.read'],
    },
    {
      name: 'users.get_space_usage',
      class: 'read',
      description:
        'Read the account-level storage quota and current usage (in bytes). Useful for surfacing capacity warnings before upload mutations.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'POST', path: '/2/users/get_space_usage', body: 'args' },
      requiredScopes: ['account_info.read'],
    },
    {
      name: 'files.list_folder',
      class: 'read',
      description:
        'List the children of a folder. Use path "" (empty string) for the account root; otherwise pass a path beginning with "/", e.g. "/Reports/2026". Returns a `cursor` for incremental pagination via files.list_folder_continue.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the folder. Use "" (empty string) for the root, otherwise leading slash, e.g. "/Reports".',
          },
          recursive: {
            type: 'boolean',
            default: false,
            description: 'Recurse into subfolders. Defaults to false (one level only).',
          },
          include_media_info: { type: 'boolean', default: false },
          include_deleted: { type: 'boolean', default: false },
          include_has_explicit_shared_members: { type: 'boolean', default: false },
          include_mounted_folders: { type: 'boolean', default: true },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 2000,
            description: 'Page size; Dropbox caps at 2000.',
          },
        },
        required: ['path'],
      },
      request: { method: 'POST', path: '/2/files/list_folder', body: 'args' },
      requiredScopes: ['files.metadata.read'],
    },
    {
      name: 'files.list_folder_continue',
      class: 'read',
      description:
        'Continue a previous files.list_folder enumeration by feeding back the `cursor` returned in the prior page. Pages until `has_more` is false.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Cursor returned from list_folder or a prior list_folder_continue.' },
        },
        required: ['cursor'],
      },
      request: { method: 'POST', path: '/2/files/list_folder/continue', body: 'args' },
      requiredScopes: ['files.metadata.read'],
    },
    {
      name: 'files.get_metadata',
      class: 'read',
      description:
        'Read metadata for a single file, folder, or deleted entry. Returns the `.tag` discriminator ("file" | "folder" | "deleted") on the entry.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path or id of the entry. Paths begin with "/"; ids look like "id:abc123".',
          },
          include_media_info: { type: 'boolean', default: false },
          include_deleted: { type: 'boolean', default: false },
          include_has_explicit_shared_members: { type: 'boolean', default: false },
        },
        required: ['path'],
      },
      request: { method: 'POST', path: '/2/files/get_metadata', body: 'args' },
      requiredScopes: ['files.metadata.read'],
    },
    {
      name: 'files.search',
      class: 'read',
      description:
        'Indexed search across the account. `query` is the free-text search string; `options` narrows by path scope, file type, and ordering. Use the returned `cursor` with files.search_continue (not exposed here) for paging.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search string.' },
          options: {
            type: 'object',
            description: 'Optional SearchOptions; e.g. { "path": "/Reports", "max_results": 50, "file_status": "active", "filename_only": false }.',
            properties: {
              path: { type: 'string' },
              max_results: { type: 'integer', minimum: 1, maximum: 1000 },
              order_by: { type: 'string', enum: ['relevance', 'last_modified_time'] },
              file_status: { type: 'string', enum: ['active', 'deleted'] },
              filename_only: { type: 'boolean' },
              file_extensions: { type: 'array', items: { type: 'string' } },
              file_categories: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: [
                    'image',
                    'document',
                    'pdf',
                    'spreadsheet',
                    'presentation',
                    'audio',
                    'video',
                    'folder',
                    'paper',
                    'others',
                  ],
                },
              },
            },
          },
          match_field_options: {
            type: 'object',
            properties: {
              include_highlights: { type: 'boolean' },
            },
          },
        },
        required: ['query'],
      },
      request: { method: 'POST', path: '/2/files/search_v2', body: 'args' },
      requiredScopes: ['files.metadata.read'],
    },
    {
      name: 'files.create_folder_v2',
      class: 'mutation',
      description:
        'Create a folder at the given path. Set `autorename` to true to let Dropbox suffix a counter on collision; otherwise Dropbox returns a `path/conflict/folder` error which the declarative layer surfaces as { status: "conflict" }.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Destination path, e.g. "/Reports/2026". Must begin with "/".',
          },
          autorename: { type: 'boolean', default: false },
        },
        required: ['path'],
      },
      request: { method: 'POST', path: '/2/files/create_folder_v2', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['files.metadata.write'],
    },
    {
      name: 'files.move_v2',
      class: 'mutation',
      description:
        'Move or rename a file or folder. Set `allow_shared_folder` and `allow_ownership_transfer` for cross-shared-folder moves. Dropbox returns `to/conflict/...` on a destination collision.',
      parameters: {
        type: 'object',
        properties: {
          from_path: { type: 'string', description: 'Current path or id.' },
          to_path: { type: 'string', description: 'New path. Must begin with "/".' },
          allow_shared_folder: { type: 'boolean', default: false },
          autorename: { type: 'boolean', default: false },
          allow_ownership_transfer: { type: 'boolean', default: false },
        },
        required: ['from_path', 'to_path'],
      },
      request: { method: 'POST', path: '/2/files/move_v2', body: 'args' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['files.metadata.write'],
    },
    {
      name: 'files.copy_v2',
      class: 'mutation',
      description:
        'Server-side copy a file or folder to a destination path. Dropbox dedupes on (to_path) and returns `to/conflict/...` on collision.',
      parameters: {
        type: 'object',
        properties: {
          from_path: { type: 'string' },
          to_path: { type: 'string' },
          allow_shared_folder: { type: 'boolean', default: false },
          autorename: { type: 'boolean', default: false },
          allow_ownership_transfer: { type: 'boolean', default: false },
        },
        required: ['from_path', 'to_path'],
      },
      request: { method: 'POST', path: '/2/files/copy_v2', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['files.metadata.write'],
    },
    {
      name: 'files.delete_v2',
      class: 'mutation',
      description:
        'Move a file or folder to the deleted state. Dropbox retains deleted items for 30 days on standard plans; pass `parent_rev` to make the delete conditional on a specific revision.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          parent_rev: { type: 'string', description: 'Optional rev (from get_metadata) to make the delete conditional.' },
        },
        required: ['path'],
      },
      request: { method: 'POST', path: '/2/files/delete_v2', body: 'args' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['files.metadata.write'],
    },
    {
      name: 'sharing.create_shared_link_with_settings',
      class: 'mutation',
      description:
        'Mint a public shared link with optional access controls (audience, requested_visibility, expires, password). Dropbox dedupes per (path, settings); a duplicate request 409s with `shared_link_already_exists` carrying the existing link, which the declarative layer surfaces as { status: "conflict" }.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to share, e.g. "/Reports/Q1.pdf".' },
          settings: {
            type: 'object',
            description: 'SharedLinkSettings; all fields optional.',
            properties: {
              requested_visibility: { type: 'string', enum: ['public', 'team_only', 'password'] },
              link_password: { type: 'string' },
              expires: { type: 'string', description: 'ISO8601 expiry timestamp.' },
              audience: { type: 'string', enum: ['public', 'team', 'no_one', 'password', 'members'] },
              access: { type: 'string', enum: ['viewer', 'editor', 'max'] },
              allow_download: { type: 'boolean' },
            },
          },
        },
        required: ['path'],
      },
      request: { method: 'POST', path: '/2/sharing/create_shared_link_with_settings', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['sharing.write'],
    },
    {
      name: 'sharing.list_shared_links',
      class: 'read',
      description:
        'List existing shared links. Filter by `path` to scope to one entry, or pass `cursor` to page through prior results. Set `direct_only` to true to exclude inherited links from parent folders.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional path to filter to one entry.' },
          cursor: { type: 'string', description: 'Pagination cursor from a prior call.' },
          direct_only: { type: 'boolean', default: false },
        },
      },
      request: { method: 'POST', path: '/2/sharing/list_shared_links', body: 'args' },
      requiredScopes: ['sharing.read'],
    },
  ],
})
