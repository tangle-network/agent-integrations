/**
 * @stable Canva Connect API connector — read designs/folders/brand-templates,
 * create designs, post comments, kick off exports + autofill jobs.
 *
 * Canva's Connect API is REST + Bearer OAuth2 (PKCE-only on the auth side;
 * confidential clients also send `client_secret` to the token endpoint). The
 * declarative-rest runtime only sees the Bearer access token at execute time,
 * so PKCE state is the host OAuth runtime's concern, not the adapter's.
 *
 * Endpoints (public docs — https://www.canva.dev/docs/connect/):
 *   - Authorize: https://www.canva.com/api/oauth/authorize
 *   - Token:     https://api.canva.com/rest/oauth/token
 *   - REST base: https://api.canva.com/rest
 *
 * Scope model: Canva uses fine-grained `<resource>:<aspect>:<read|write>`
 * scopes. We request the union covering the capability surface below:
 *   - design.{content,meta,permission}.{read,write}
 *   - asset.{read,write}
 *   - brandtemplate.{content,meta}.read
 *   - comment.{read,write}
 *   - folder.{read,write}
 *   - profile.read
 * `app:read`/`app:write` are intentionally excluded — they govern Canva-app
 * builder surfaces, not Connect data flows.
 *
 * Identifier nomenclature (from Canva's API reference):
 *   - design_id        : the public `DAFxxxx` design id
 *   - folder_id        : `FAFxxxx`; `root` is the user's top-level folder
 *   - asset_id         : `Mxxxx` returned by uploads
 *   - brand_template_id: returned from /v1/brand-templates
 *   - comment_id       : returned from comment endpoints
 *   - job_id           : returned by long-running endpoints
 *                        (asset-uploads, exports, autofills, design-imports)
 *
 * Async jobs: every long-running endpoint returns `{ job: { id, status } }`
 * and is polled via its sibling GET /v1/<resource>/{jobId}. The polling GET
 * is exposed as a separate `read` capability so the agent can wait without
 * holding a mutation in-flight.
 */

import { declarativeRestConnector } from './declarative-rest.js'

export const canvaConnector = declarativeRestConnector({
  kind: 'canva',
  displayName: 'Canva',
  description:
    'Read Canva designs, folders, assets, brand templates, and comments; create designs, upload assets, post comments, and trigger export / autofill jobs through the Connect API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.canva.com/api/oauth/authorize',
    tokenUrl: 'https://api.canva.com/rest/oauth/token',
    scopes: [
      'design:content:read',
      'design:content:write',
      'design:meta:read',
      'design:permission:read',
      'design:permission:write',
      'asset:read',
      'asset:write',
      'brandtemplate:content:read',
      'brandtemplate:meta:read',
      'comment:read',
      'comment:write',
      'folder:read',
      'folder:write',
      'profile:read',
    ],
    clientIdEnv: 'CANVA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CANVA_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.canva.com/rest',
  test: { method: 'GET', path: '/v1/users/me' },
  capabilities: [
    {
      name: 'users.me',
      class: 'read',
      description: 'Return the Canva user id for the connected account.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/v1/users/me' },
      requiredScopes: ['profile:read'],
    },
    {
      name: 'users.me.profile',
      class: 'read',
      description: 'Return the connected user profile (display name, etc.).',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/v1/users/me/profile' },
      requiredScopes: ['profile:read'],
    },
    {
      name: 'designs.list',
      class: 'read',
      description: 'List designs visible to the connected user.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text design search.' },
          continuation: { type: 'string', description: 'Opaque cursor from a prior page.' },
          ownership: { type: 'string', enum: ['any', 'owned', 'shared'] },
          sort_by: {
            type: 'string',
            enum: ['relevance', 'modified_descending', 'modified_ascending', 'title_descending', 'title_ascending'],
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/designs',
        query: {
          query: '{query}',
          continuation: '{continuation}',
          ownership: '{ownership}',
          sort_by: '{sort_by}',
        },
      },
      requiredScopes: ['design:meta:read'],
    },
    {
      name: 'designs.get',
      class: 'read',
      description: 'Fetch a single design by id.',
      parameters: {
        type: 'object',
        properties: { design_id: { type: 'string' } },
        required: ['design_id'],
      },
      request: { method: 'GET', path: '/v1/designs/{design_id}' },
      requiredScopes: ['design:meta:read'],
    },
    {
      name: 'designs.pages.list',
      class: 'read',
      description: 'List pages inside a design (paginated by offset/limit).',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          offset: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['design_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/designs/{design_id}/pages',
        query: { offset: '{offset}', limit: '{limit}' },
      },
      requiredScopes: ['design:content:read'],
    },
    {
      name: 'folders.get',
      class: 'read',
      description: 'Fetch a folder by id. Use the literal "root" to read the user root folder.',
      parameters: {
        type: 'object',
        properties: { folder_id: { type: 'string' } },
        required: ['folder_id'],
      },
      request: { method: 'GET', path: '/v1/folders/{folder_id}' },
      requiredScopes: ['folder:read'],
    },
    {
      name: 'folders.items.list',
      class: 'read',
      description: 'List items (designs, folders, images) inside a folder.',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'string' },
          continuation: { type: 'string' },
          item_types: {
            type: 'string',
            description: 'Comma-separated list: design, folder, image.',
          },
        },
        required: ['folder_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/folders/{folder_id}/items',
        query: { continuation: '{continuation}', item_types: '{item_types}' },
      },
      requiredScopes: ['folder:read'],
    },
    {
      name: 'assets.get',
      class: 'read',
      description: 'Fetch an asset by id.',
      parameters: {
        type: 'object',
        properties: { asset_id: { type: 'string' } },
        required: ['asset_id'],
      },
      request: { method: 'GET', path: '/v1/assets/{asset_id}' },
      requiredScopes: ['asset:read'],
    },
    {
      name: 'asset_uploads.get',
      class: 'read',
      description: 'Poll an async asset-upload job by id; returns status + asset reference when done.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/v1/asset-uploads/{job_id}' },
      requiredScopes: ['asset:read'],
    },
    {
      name: 'brand_templates.list',
      class: 'read',
      description: 'List brand templates the connected user can autofill (Canva Enterprise feature).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          continuation: { type: 'string' },
          ownership: { type: 'string', enum: ['any', 'owned', 'shared'] },
          sort_by: {
            type: 'string',
            enum: ['relevance', 'modified_descending', 'modified_ascending', 'title_descending', 'title_ascending'],
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/brand-templates',
        query: {
          query: '{query}',
          continuation: '{continuation}',
          ownership: '{ownership}',
          sort_by: '{sort_by}',
        },
      },
      requiredScopes: ['brandtemplate:meta:read'],
    },
    {
      name: 'brand_templates.get',
      class: 'read',
      description: 'Fetch a brand template by id.',
      parameters: {
        type: 'object',
        properties: { brand_template_id: { type: 'string' } },
        required: ['brand_template_id'],
      },
      request: { method: 'GET', path: '/v1/brand-templates/{brand_template_id}' },
      requiredScopes: ['brandtemplate:meta:read'],
    },
    {
      name: 'brand_templates.dataset',
      class: 'read',
      description: 'Fetch the autofill dataset definition for a brand template (field names + types).',
      parameters: {
        type: 'object',
        properties: { brand_template_id: { type: 'string' } },
        required: ['brand_template_id'],
      },
      request: { method: 'GET', path: '/v1/brand-templates/{brand_template_id}/dataset' },
      requiredScopes: ['brandtemplate:content:read'],
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List threaded comments on a design.',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          continuation: { type: 'string' },
        },
        required: ['design_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/designs/{design_id}/comments',
        query: { continuation: '{continuation}' },
      },
      requiredScopes: ['comment:read'],
    },
    {
      name: 'comments.replies.list',
      class: 'read',
      description: 'List replies underneath a top-level comment on a design.',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          comment_id: { type: 'string' },
          continuation: { type: 'string' },
        },
        required: ['design_id', 'comment_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/designs/{design_id}/comments/{comment_id}/replies',
        query: { continuation: '{continuation}' },
      },
      requiredScopes: ['comment:read'],
    },
    {
      name: 'exports.get',
      class: 'read',
      description: 'Poll an export job by id; returns download URLs when status=success.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/v1/exports/{job_id}' },
      requiredScopes: ['design:content:read'],
    },
    {
      name: 'autofills.get',
      class: 'read',
      description: 'Poll an autofill job by id; returns the resulting design reference when done.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/v1/autofills/{job_id}' },
      requiredScopes: ['brandtemplate:content:read'],
    },
    {
      name: 'design_imports.get',
      class: 'read',
      description: 'Poll a design-import job by id; returns the imported design reference when done.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/v1/design-imports/{job_id}' },
      requiredScopes: ['design:content:write'],
    },
    {
      name: 'designs.create',
      class: 'mutation',
      description:
        'Create a new design. design_type is either { type: "preset", name: "doc" | "whiteboard" | "presentation" } or { type: "custom", width, height }.',
      parameters: {
        type: 'object',
        properties: {
          design_type: {
            type: 'object',
            description: 'Preset or custom design dimensions per the Canva API schema.',
          },
          asset_id: { type: 'string', description: 'Optional asset to drop onto the first page.' },
          title: { type: 'string' },
        },
        required: ['design_type'],
      },
      request: {
        method: 'POST',
        path: '/v1/designs',
        body: {
          design_type: '{design_type}',
          asset_id: '{asset_id}',
          title: '{title}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['design:content:write'],
    },
    {
      name: 'folders.create',
      class: 'mutation',
      description: 'Create a folder under a parent folder.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          parent_folder_id: { type: 'string', description: 'Parent folder id ("root" for the user root).' },
        },
        required: ['name', 'parent_folder_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/folders',
        body: { name: '{name}', parent_folder_id: '{parent_folder_id}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['folder:write'],
    },
    {
      name: 'folders.update',
      class: 'mutation',
      description: 'Rename a folder.',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['folder_id', 'name'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/folders/{folder_id}',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['folder:write'],
    },
    {
      name: 'folders.delete',
      class: 'mutation',
      description: 'Delete a folder. The folder must be empty.',
      parameters: {
        type: 'object',
        properties: { folder_id: { type: 'string' } },
        required: ['folder_id'],
      },
      request: { method: 'DELETE', path: '/v1/folders/{folder_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['folder:write'],
    },
    {
      name: 'folders.items.move',
      class: 'mutation',
      description: 'Move an item (design / folder / image) into a folder.',
      parameters: {
        type: 'object',
        properties: {
          to_folder_id: { type: 'string' },
          item_id: { type: 'string' },
        },
        required: ['to_folder_id', 'item_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/folders/move',
        body: { to_folder_id: '{to_folder_id}', item_id: '{item_id}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['folder:write'],
    },
    {
      name: 'assets.update',
      class: 'mutation',
      description: 'Update asset metadata (name and/or tags).',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string' },
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['asset_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/assets/{asset_id}',
        body: { name: '{name}', tags: '{tags}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['asset:write'],
    },
    {
      name: 'assets.delete',
      class: 'mutation',
      description: 'Delete an asset by id.',
      parameters: {
        type: 'object',
        properties: { asset_id: { type: 'string' } },
        required: ['asset_id'],
      },
      request: { method: 'DELETE', path: '/v1/assets/{asset_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['asset:write'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Post a top-level comment on a design.',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          message: { type: 'string' },
          assignee_id: { type: 'string', description: 'Optional Canva user id to assign the comment to.' },
        },
        required: ['design_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/v1/designs/{design_id}/comments',
        body: { message: '{message}', assignee_id: '{assignee_id}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['comment:write'],
    },
    {
      name: 'comments.reply',
      class: 'mutation',
      description: 'Reply to a comment thread on a design.',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          comment_id: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['design_id', 'comment_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/v1/designs/{design_id}/comments/{comment_id}/replies',
        body: { message: '{message}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['comment:write'],
    },
    {
      name: 'exports.create',
      class: 'mutation',
      description:
        'Kick off an export job. format is { type: "pdf" | "jpg" | "png" | "pptx" | "mp4" | "gif", ...extra }. Returns { job: { id, status } } — poll exports.get to get download URLs.',
      parameters: {
        type: 'object',
        properties: {
          design_id: { type: 'string' },
          format: { type: 'object', description: 'Canva export format object.' },
        },
        required: ['design_id', 'format'],
      },
      request: {
        method: 'POST',
        path: '/v1/exports',
        body: { design_id: '{design_id}', format: '{format}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
      requiredScopes: ['design:content:read'],
    },
    {
      name: 'autofills.create',
      class: 'mutation',
      description:
        'Kick off an autofill job: render a brand template with structured field data. Returns { job: { id, status } } — poll autofills.get for the resulting design.',
      parameters: {
        type: 'object',
        properties: {
          brand_template_id: { type: 'string' },
          data: { type: 'object', description: 'Keyed by dataset field name → field value.' },
          title: { type: 'string' },
        },
        required: ['brand_template_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v1/autofills',
        body: {
          brand_template_id: '{brand_template_id}',
          data: '{data}',
          title: '{title}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['brandtemplate:content:read', 'design:content:write'],
    },
    {
      name: 'asset_uploads.create',
      class: 'mutation',
      description:
        'Create an asset-upload job from a remote URL. Returns { job: { id, status } } — poll asset_uploads.get for the asset reference. Direct binary uploads use a separate multipart endpoint not exposed here.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filename for the uploaded asset.' },
          url: { type: 'string', format: 'uri', description: 'Public URL Canva should fetch from.' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'url'],
      },
      request: {
        method: 'POST',
        path: '/v1/url-asset-uploads',
        body: { name: '{name}', url: '{url}', tags: '{tags}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['asset:write'],
    },
  ],
})
