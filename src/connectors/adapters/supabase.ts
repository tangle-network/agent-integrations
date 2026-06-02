import { declarativeRestConnector } from './declarative-rest.js'

// Supabase Management API OAuth2 endpoints.
// authorizeUrl: https://api.supabase.com/v1/oauth/authorize
// tokenUrl:     https://api.supabase.com/v1/oauth/token
// Docs: https://supabase.com/docs/reference/api/introduction
//
// Token is a short-lived (1h) access token tied to the authorizing user's
// org memberships. Scopes are coarse pairs of {resource}:{read|write}
// declared in the Supabase OAuth App settings; the customer must enable
// every scope listed below in the App console before issuing the grant.
export const supabaseConnector = declarativeRestConnector({
  kind: 'supabase',
  displayName: 'Supabase',
  description:
    'Inspect Supabase projects, run SQL against the Postgres database, and manage secrets via the Management API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
    tokenUrl: 'https://api.supabase.com/v1/oauth/token',
    scopes: [
      'organizations:read',
      'projects:read',
      'projects:write',
      'database:read',
      'database:write',
      'secrets:read',
      'secrets:write',
    ],
    clientIdEnv: 'SUPABASE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SUPABASE_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.supabase.com',
  test: { method: 'GET', path: '/v1/organizations' },
  capabilities: [
    {
      name: 'organizations.list',
      class: 'read',
      description: 'List Supabase organizations the authorizing user belongs to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/organizations' },
      requiredScopes: ['organizations:read'],
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List Supabase projects across the authorized organizations.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/projects' },
      requiredScopes: ['projects:read'],
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Read a Supabase project by its reference id.',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'Project ref (e.g. abcdefghijklmnop).' } },
        required: ['ref'],
      },
      request: { method: 'GET', path: '/v1/projects/{ref}' },
      requiredScopes: ['projects:read'],
    },
    {
      name: 'database.query',
      class: 'read',
      description: 'Run a read-only SQL query against the project Postgres database.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          query: { type: 'string', description: 'SQL statement. Mutations are rejected unless database:write is granted.' },
        },
        required: ['ref', 'query'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{ref}/database/query',
        body: { query: '{query}' },
      },
      requiredScopes: ['database:read'],
    },
    {
      name: 'database.execute',
      class: 'mutation',
      description: 'Execute a mutating SQL statement (INSERT/UPDATE/DELETE/DDL) against the project Postgres database.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['ref', 'query'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{ref}/database/query',
        body: { query: '{query}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['database:write'],
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Provision a new Supabase project under an organization.',
      parameters: {
        type: 'object',
        properties: {
          organization_id: { type: 'string' },
          name: { type: 'string' },
          region: { type: 'string', description: 'AWS region slug, e.g. us-east-1.' },
          db_pass: { type: 'string', description: 'Initial Postgres superuser password.' },
          plan: { type: 'string', enum: ['free', 'pro'] },
        },
        required: ['organization_id', 'name', 'region', 'db_pass'],
      },
      request: { method: 'POST', path: '/v1/projects', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['projects:write'],
    },
    {
      name: 'secrets.list',
      class: 'read',
      description: 'List project edge-function secrets (names only; values are write-only).',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
      },
      request: { method: 'GET', path: '/v1/projects/{ref}/secrets' },
      requiredScopes: ['secrets:read'],
    },
    {
      name: 'secrets.upsert',
      class: 'mutation',
      description: 'Create or update project edge-function secrets in bulk.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          secrets: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, value: { type: 'string' } },
              required: ['name', 'value'],
            },
          },
        },
        required: ['ref', 'secrets'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{ref}/secrets',
        body: '{secrets}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['secrets:write'],
    },
    {
      name: 'projects.delete',
      class: 'mutation',
      description: 'Delete a Supabase project. Permanently removes the project and all data.',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
      },
      request: { method: 'DELETE', path: '/v1/projects/{ref}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['projects:write'],
    },
    {
      name: 'branches.create',
      class: 'mutation',
      description: 'Create a preview branch on a Supabase project. Pass git_branch and region as optional fields when needed.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          branch_name: { type: 'string' },
          git_branch: { type: 'string', description: 'Optional git branch to link.' },
          region: { type: 'string' },
        },
        required: ['ref', 'branch_name'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{ref}/branches',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['projects:write'],
    },
    {
      name: 'branches.delete',
      class: 'mutation',
      description: 'Delete a preview branch.',
      parameters: {
        type: 'object',
        properties: { branch_id: { type: 'string' } },
        required: ['branch_id'],
      },
      request: { method: 'DELETE', path: '/v1/branches/{branch_id}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['projects:write'],
    },
    {
      name: 'secrets.delete',
      class: 'mutation',
      description:
        'Delete a project edge-function secret by name. Note: the Supabase Management API also accepts a JSON-array body for bulk deletes; this capability deletes a single named secret per call via query parameter.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          name: { type: 'string', description: 'Secret name to delete.' },
        },
        required: ['ref', 'name'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/projects/{ref}/secrets',
        query: { name: '{name}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['secrets:write'],
    },
    {
      name: 'storage.upload',
      class: 'mutation',
      description:
        'Upload an object to a Supabase storage bucket. The body is the object payload; storage uses a separate hostname per project so callers must override metadata.baseUrl for storage calls.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          bucket: { type: 'string' },
          path: { type: 'string', description: 'Object path inside the bucket.' },
          content: { type: 'string', description: 'Object content (raw or base64).' },
        },
        required: ['ref', 'bucket', 'path', 'content'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{ref}/storage/buckets/{bucket}/objects/{path}',
        body: '{content}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['projects:write'],
    },
  ],
})
