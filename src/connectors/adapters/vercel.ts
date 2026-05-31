import { declarativeRestConnector } from './declarative-rest.js'

// Vercel REST API adapter (api.vercel.com).
//
// Auth: Vercel issues OAuth2 access tokens to integrations published through
// the Vercel marketplace. The install flow is:
//   1. User clicks "Install" on the integration listing
//        https://vercel.com/integrations/<slug>/new
//      where <slug> is the integration's marketplace slug pinned to the OAuth
//      client_id. The hub renders this URL by reading the integration slug
//      out of `VERCEL_INTEGRATION_SLUG` and substituting it into the
//      authorization endpoint at connect time (the connector framework
//      delivers the slug via the integration's authorize handler — we expose
//      the canonical SaaS install entry point here).
//   2. Vercel redirects back to the registered redirect_uri with
//        ?code=<one-time>&configurationId=<conf>&teamId=<team>&next=<url>
//   3. Consumer POSTs the code to
//        https://api.vercel.com/v2/oauth/access_token
//      with form-encoded { client_id, client_secret, code, redirect_uri }.
//      Response: { access_token, token_type:"Bearer", team_id, user_id,
//      installation_id }.
// Reference: https://vercel.com/docs/integrations/create-integration/oauth-with-vercel
//
// Tokens are long-lived (no refresh_token issued) and identify either a user
// or a team installation. Every authenticated API call accepts an optional
// `teamId` query param for team-scoped resources; we expose it as an
// optional argument on the relevant capabilities so a single integration
// install can serve a user across all their teams.
//
// CAS strategy:
//   - Project + env-var + domain mutations: native-idempotency. Vercel
//     responds with a deterministic 409 when a project name / env-var key /
//     domain already exists, which `declarative-rest` surfaces as a
//     `status:'conflict'` mutation result without retry.
//   - Deployment creation: native-idempotency. Vercel deduplicates by
//     `deploymentId` and the caller's `Idempotency-Key` header (forwarded by
//     the SDK guard, not the adapter).
//   - Deployment cancel: native-idempotency. Cancelling a finished deployment
//     is a no-op upstream.
export const vercelConnector = declarativeRestConnector({
  kind: 'vercel',
  displayName: 'Vercel',
  description:
    'List Vercel projects and deployments, create and cancel deployments, manage project environment variables, and inspect domains for a connected Vercel account or team.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://vercel.com/integrations/install',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    // Vercel's OAuth grant model does not use granular per-resource scopes:
    // the marketplace integration's manifest declares the permission set
    // (read|read-write per resource family), and the install URL above
    // surfaces that to the user. We mirror those resource families here so
    // the agent's tool registry can gate capabilities on the same names
    // Vercel shows the customer at install time.
    scopes: [
      'user:read',
      'team:read',
      'project:read',
      'project:read-write',
      'deployment:read',
      'deployment:read-write',
      'env:read',
      'env:read-write',
      'domain:read',
    ],
    clientIdEnv: 'VERCEL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'VERCEL_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vercel.com',
  test: { method: 'GET', path: '/v2/user' },
  capabilities: [
    {
      name: 'user.get',
      class: 'read',
      description: 'Return the authenticated Vercel user (id, email, username, default team).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/user' },
      requiredScopes: ['user:read'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List teams the authenticated identity belongs to. Pagination via `since` (createdAt cursor) and `limit`.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          since: { type: 'integer', description: 'Unix-ms cursor; return teams created before this value.' },
          until: { type: 'integer', description: 'Unix-ms cursor; return teams created after this value.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/teams',
        query: { limit: '{limit}', since: '{since}', until: '{until}' },
      },
      requiredScopes: ['team:read'],
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List projects visible to the authenticated identity (optionally scoped to a team).',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Scope to a specific team id (e.g. "team_xxx").' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          search: { type: 'string', description: 'Substring match against project name.' },
          from: { type: 'integer', description: 'Unix-ms pagination cursor returned by a prior page.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v9/projects',
        query: { teamId: '{teamId}', limit: '{limit}', search: '{search}', from: '{from}' },
      },
      requiredScopes: ['project:read'],
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Read a single Vercel project by id or name.',
      parameters: {
        type: 'object',
        properties: {
          idOrName: { type: 'string', description: 'Project id (prj_…) or project name.' },
          teamId: { type: 'string' },
        },
        required: ['idOrName'],
      },
      request: {
        method: 'GET',
        path: '/v9/projects/{idOrName}',
        query: { teamId: '{teamId}' },
      },
      requiredScopes: ['project:read'],
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a Vercel project. Name is required; framework + gitRepository optional.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Lowercase, hyphen-separated project name.' },
          framework: {
            type: 'string',
            description: 'Vercel framework preset slug (e.g. "nextjs", "vite", "astro", "remix").',
          },
          gitRepository: {
            type: 'object',
            description: 'Link a Git repository at creation time (optional).',
            properties: {
              type: { type: 'string', enum: ['github', 'gitlab', 'bitbucket'] },
              repo: { type: 'string', description: 'owner/repo slug.' },
            },
          },
          publicSource: { type: 'boolean' },
          rootDirectory: { type: 'string' },
          buildCommand: { type: 'string' },
          installCommand: { type: 'string' },
          outputDirectory: { type: 'string' },
          devCommand: { type: 'string' },
          teamId: { type: 'string', description: 'Scope to a specific team id (e.g. "team_xxx").' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v9/projects',
        query: { teamId: '{teamId}' },
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['project:read-write'],
    },
    {
      name: 'projects.delete',
      class: 'mutation',
      description: 'Delete a Vercel project by id or name. Destructive: removes all deployments and aliases.',
      parameters: {
        type: 'object',
        properties: {
          idOrName: { type: 'string' },
          teamId: { type: 'string' },
        },
        required: ['idOrName'],
      },
      request: {
        method: 'DELETE',
        path: '/v9/projects/{idOrName}',
        query: { teamId: '{teamId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['project:read-write'],
    },
    {
      name: 'deployments.list',
      class: 'read',
      description: 'List deployments, optionally filtered by project, state, target, or time range.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          projectId: { type: 'string', description: 'Filter by Vercel project id (prj_…).' },
          app: { type: 'string', description: 'Filter by project name.' },
          state: {
            type: 'string',
            description: 'Comma-separated deployment states.',
            enum: [
              'BUILDING',
              'ERROR',
              'INITIALIZING',
              'QUEUED',
              'READY',
              'CANCELED',
            ],
          },
          target: { type: 'string', enum: ['production', 'preview'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          since: { type: 'integer', description: 'Unix-ms; deployments created after this timestamp.' },
          until: { type: 'integer', description: 'Unix-ms; deployments created before this timestamp.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v6/deployments',
        query: {
          teamId: '{teamId}',
          projectId: '{projectId}',
          app: '{app}',
          state: '{state}',
          target: '{target}',
          limit: '{limit}',
          since: '{since}',
          until: '{until}',
        },
      },
      requiredScopes: ['deployment:read'],
    },
    {
      name: 'deployments.get',
      class: 'read',
      description: 'Read a single deployment by id (dpl_…) or alias URL.',
      parameters: {
        type: 'object',
        properties: {
          idOrUrl: { type: 'string', description: 'Deployment id (dpl_…) or alias (myapp.vercel.app).' },
          teamId: { type: 'string' },
          withGitRepoInfo: { type: 'boolean' },
        },
        required: ['idOrUrl'],
      },
      request: {
        method: 'GET',
        path: '/v13/deployments/{idOrUrl}',
        query: { teamId: '{teamId}', withGitRepoInfo: '{withGitRepoInfo}' },
      },
      requiredScopes: ['deployment:read'],
    },
    {
      name: 'deployments.create',
      class: 'mutation',
      description: 'Trigger a new deployment for a project (Git-linked redeploy or file upload).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name to deploy under.' },
          project: { type: 'string', description: 'Project id (prj_…) or name (alternative to `name`).' },
          target: { type: 'string', enum: ['production', 'staging'] },
          gitSource: {
            type: 'object',
            description: 'Trigger a Git-based deploy (e.g. {type:"github",ref:"main",repoId:123}).',
          },
          files: {
            type: 'array',
            description: 'File manifest for file-upload deploys ({file,sha,size}[]).',
            items: { type: 'object' },
          },
          deploymentId: {
            type: 'string',
            description: 'When set, redeploys an existing deployment by id (rollback / promote).',
          },
          teamId: { type: 'string' },
          forceNew: { type: 'boolean', description: 'Force a new build even if the source is unchanged.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v13/deployments',
        query: { teamId: '{teamId}', forceNew: '{forceNew}' },
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['deployment:read-write'],
    },
    {
      name: 'deployments.cancel',
      class: 'mutation',
      description: 'Cancel an in-progress deployment by id. No-op upstream if the deployment is already terminal.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Deployment id (dpl_…).' },
          teamId: { type: 'string' },
        },
        required: ['id'],
      },
      request: {
        method: 'PATCH',
        path: '/v12/deployments/{id}/cancel',
        query: { teamId: '{teamId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['deployment:read-write'],
    },
    {
      name: 'env.list',
      class: 'read',
      description: 'List environment variables on a project.',
      parameters: {
        type: 'object',
        properties: {
          idOrName: { type: 'string' },
          teamId: { type: 'string' },
          decrypt: {
            type: 'boolean',
            description: 'Return decrypted plaintext values (requires env:read-write scope).',
          },
        },
        required: ['idOrName'],
      },
      request: {
        method: 'GET',
        path: '/v9/projects/{idOrName}/env',
        query: { teamId: '{teamId}', decrypt: '{decrypt}' },
      },
      requiredScopes: ['env:read'],
    },
    {
      name: 'env.create',
      class: 'mutation',
      description: 'Create one or more environment variables on a project.',
      parameters: {
        type: 'object',
        properties: {
          idOrName: { type: 'string' },
          teamId: { type: 'string' },
          key: { type: 'string', description: 'Variable key (uppercase, underscore-separated).' },
          value: { type: 'string', description: 'Variable value. Stored encrypted upstream.' },
          type: {
            type: 'string',
            enum: ['system', 'secret', 'encrypted', 'plain', 'sensitive'],
          },
          target: {
            type: 'array',
            description: 'Environments this var applies to.',
            items: { type: 'string', enum: ['production', 'preview', 'development'] },
          },
          gitBranch: { type: 'string', description: 'Optional preview-branch scope.' },
          comment: { type: 'string' },
        },
        required: ['idOrName', 'key', 'value', 'type', 'target'],
      },
      request: {
        method: 'POST',
        path: '/v10/projects/{idOrName}/env',
        query: { teamId: '{teamId}' },
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['env:read-write'],
    },
    {
      name: 'env.delete',
      class: 'mutation',
      description: 'Delete an environment variable from a project by env-var id.',
      parameters: {
        type: 'object',
        properties: {
          idOrName: { type: 'string' },
          envId: { type: 'string' },
          teamId: { type: 'string' },
        },
        required: ['idOrName', 'envId'],
      },
      request: {
        method: 'DELETE',
        path: '/v9/projects/{idOrName}/env/{envId}',
        query: { teamId: '{teamId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['env:read-write'],
    },
    {
      name: 'domains.list',
      class: 'read',
      description: 'List domains owned by the authenticated identity (or team).',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          since: { type: 'integer' },
          until: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v5/domains',
        query: { teamId: '{teamId}', limit: '{limit}', since: '{since}', until: '{until}' },
      },
      requiredScopes: ['domain:read'],
    },
    {
      name: 'domains.get',
      class: 'read',
      description: 'Read a single domain by name (e.g. "acme.com").',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          teamId: { type: 'string' },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/v5/domains/{domain}',
        query: { teamId: '{teamId}' },
      },
      requiredScopes: ['domain:read'],
    },
  ],
})
