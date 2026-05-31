import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Netlify adapter for the public Netlify REST API (api.netlify.com/api/v1).
 *
 * OAuth2 authorization endpoints come straight from the Netlify OAuth docs:
 *   https://docs.netlify.com/api/get-started/#authentication
 *   https://www.netlify.com/blog/2016/10/10/integrating-with-netlify-oauth2/
 *
 *   authorize: https://app.netlify.com/authorize
 *   token:     https://api.netlify.com/oauth/token
 *
 * Netlify OAuth does not expose granular scopes — the issued access token is
 * scoped to the authorizing user and inherits whatever the user can do on the
 * sites/teams they belong to. We pass an empty `scopes` array so the SDK does
 * not attempt to append `scope=...` query parameters that Netlify would
 * silently ignore (and that some OAuth client libs treat as a grant
 * mismatch).
 *
 * Access tokens are sent as `Authorization: Bearer <token>` against
 * https://api.netlify.com/api/v1, which is the default base URL we ship.
 * Operators running Netlify Enterprise can override `metadata.apiBaseUrl` on
 * a DataSource to point at a private API surface without forking this
 * adapter.
 *
 * Capability surface covers the deployment workflow that matters to an agent:
 *   - inventory: list/get sites, list/get deploys, environment variables
 *   - mutation: trigger build hooks, lock/unlock deploys, restore a deploy,
 *     create/update/delete env vars, update site config, delete a site/deploy
 *
 * Every mutation declares `cas: 'native-idempotency'` (Netlify endpoints are
 * idempotent on retry by deploy/site id and accept repeated PATCHes) or
 * `'optimistic-read-verify'` for the update flows where Netlify will silently
 * merge a stale PATCH if we did not read-before-write.
 */
export const netlifyConnector = declarativeRestConnector({
  kind: 'netlify',
  displayName: 'Netlify',
  description:
    'Inspect Netlify sites and deploys, trigger build hooks, manage environment variables, and drive deploy lifecycle (lock / unlock / restore / delete).',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.netlify.com/authorize',
    tokenUrl: 'https://api.netlify.com/oauth/token',
    scopes: [],
    clientIdEnv: 'NETLIFY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NETLIFY_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.netlify.com/api/v1' },
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'user.get',
      class: 'read',
      description: 'Read the authenticated Netlify user (id, email, default account).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/user' },
    },
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List Netlify accounts (teams) the authenticated user belongs to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/accounts' },
    },
    {
      name: 'sites.list',
      class: 'read',
      description: 'List Netlify sites visible to the authenticated user, optionally filtered by name or account.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filter by site name (subdomain).' },
          filter: { type: 'string', enum: ['all', 'owner', 'guest'] },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/sites',
        query: { name: '{name}', filter: '{filter}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'sites.get',
      class: 'read',
      description: 'Read a single Netlify site by id.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string', description: 'Netlify site id or custom domain.' },
        },
        required: ['site_id'],
      },
      request: { method: 'GET', path: '/sites/{site_id}' },
    },
    {
      name: 'sites.deploys.list',
      class: 'read',
      description: 'List deploys for a site (most recent first).',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['site_id'],
      },
      request: {
        method: 'GET',
        path: '/sites/{site_id}/deploys',
        query: { page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'deploys.get',
      class: 'read',
      description: 'Read a single deploy by id.',
      parameters: {
        type: 'object',
        properties: {
          deploy_id: { type: 'string' },
        },
        required: ['deploy_id'],
      },
      request: { method: 'GET', path: '/deploys/{deploy_id}' },
    },
    {
      name: 'sites.build-hooks.list',
      class: 'read',
      description: 'List build hooks configured for a site.',
      parameters: {
        type: 'object',
        properties: { site_id: { type: 'string' } },
        required: ['site_id'],
      },
      request: { method: 'GET', path: '/sites/{site_id}/build_hooks' },
    },
    {
      name: 'sites.env.list',
      class: 'read',
      description: 'List environment variables configured for a site within an account.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Netlify account (team) slug or id.' },
          site_id: { type: 'string', description: 'Site id to scope env vars to.' },
          context_name: {
            type: 'string',
            enum: ['all', 'dev', 'branch-deploy', 'deploy-preview', 'production'],
            description: 'Optional deploy context filter.',
          },
        },
        required: ['account_id'],
      },
      request: {
        method: 'GET',
        path: '/accounts/{account_id}/env',
        query: { site_id: '{site_id}', context_name: '{context_name}' },
      },
    },
    {
      name: 'sites.env.get',
      class: 'read',
      description: 'Read a single environment variable by key.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          key: { type: 'string' },
          site_id: { type: 'string' },
        },
        required: ['account_id', 'key'],
      },
      request: {
        method: 'GET',
        path: '/accounts/{account_id}/env/{key}',
        query: { site_id: '{site_id}' },
      },
    },
    {
      name: 'forms.list',
      class: 'read',
      description: 'List forms across the sites the user can access (or scoped to a single site).',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string', description: 'Optional — when present scopes the listing to one site.' },
        },
      },
      request: {
        method: 'GET',
        path: '/sites/{site_id}/forms',
      },
    },
    {
      name: 'sites.create',
      class: 'mutation',
      description: 'Create a new Netlify site under an account.',
      parameters: {
        type: 'object',
        properties: {
          account_slug: { type: 'string', description: 'Account (team) slug under which to create the site.' },
          fields: {
            type: 'object',
            description: 'Site creation payload (name, custom_domain, repo, build_settings, etc.).',
            properties: {
              name: { type: 'string' },
              custom_domain: { type: 'string' },
              password: { type: 'string' },
              force_ssl: { type: 'boolean' },
              repo: { type: 'object' },
            },
          },
        },
        required: ['account_slug', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/{account_slug}/sites',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.update',
      class: 'mutation',
      description: 'Patch a Netlify site (name, custom_domain, build_settings, …).',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              custom_domain: { type: 'string' },
              password: { type: 'string' },
              force_ssl: { type: 'boolean' },
              build_settings: { type: 'object' },
              processing_settings: { type: 'object' },
            },
          },
        },
        required: ['site_id', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/sites/{site_id}',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'sites.delete',
      class: 'mutation',
      description: 'Delete a Netlify site. Permanent — removes all deploys and DNS records owned by the site.',
      parameters: {
        type: 'object',
        properties: { site_id: { type: 'string' } },
        required: ['site_id'],
      },
      request: { method: 'DELETE', path: '/sites/{site_id}' },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.build-hooks.trigger',
      class: 'mutation',
      description:
        'Trigger a Netlify build hook to start a new deploy. `hook_id` is the build-hook id returned by sites.build-hooks.list.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          hook_id: { type: 'string' },
          trigger_branch: { type: 'string', description: 'Optional override of the branch the build hook builds.' },
          trigger_title: { type: 'string', description: 'Optional human-readable label written into the deploy log.' },
        },
        required: ['site_id', 'hook_id'],
      },
      request: {
        method: 'POST',
        path: '/build_hooks/{hook_id}',
        body: {
          trigger_branch: '{trigger_branch}',
          trigger_title: '{trigger_title}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.build-hooks.create',
      class: 'mutation',
      description: 'Create a new build hook for a site.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              branch: { type: 'string' },
            },
            required: ['title'],
          },
        },
        required: ['site_id', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/sites/{site_id}/build_hooks',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.build-hooks.delete',
      class: 'mutation',
      description: 'Delete a build hook from a site.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          hook_id: { type: 'string' },
        },
        required: ['site_id', 'hook_id'],
      },
      request: { method: 'DELETE', path: '/sites/{site_id}/build_hooks/{hook_id}' },
      cas: 'native-idempotency',
    },
    {
      name: 'deploys.restore',
      class: 'mutation',
      description: 'Restore a previous deploy to be the published deploy for its site.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          deploy_id: { type: 'string' },
        },
        required: ['site_id', 'deploy_id'],
      },
      request: {
        method: 'POST',
        path: '/sites/{site_id}/deploys/{deploy_id}/restore',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'deploys.lock',
      class: 'mutation',
      description: 'Lock the current published deploy so future deploys do not auto-publish.',
      parameters: {
        type: 'object',
        properties: { deploy_id: { type: 'string' } },
        required: ['deploy_id'],
      },
      request: { method: 'POST', path: '/deploys/{deploy_id}/lock' },
      cas: 'native-idempotency',
    },
    {
      name: 'deploys.unlock',
      class: 'mutation',
      description: 'Unlock a deploy so subsequent successful deploys can auto-publish.',
      parameters: {
        type: 'object',
        properties: { deploy_id: { type: 'string' } },
        required: ['deploy_id'],
      },
      request: { method: 'POST', path: '/deploys/{deploy_id}/unlock' },
      cas: 'native-idempotency',
    },
    {
      name: 'deploys.cancel',
      class: 'mutation',
      description: 'Cancel an in-progress deploy.',
      parameters: {
        type: 'object',
        properties: { deploy_id: { type: 'string' } },
        required: ['deploy_id'],
      },
      request: { method: 'POST', path: '/deploys/{deploy_id}/cancel' },
      cas: 'native-idempotency',
    },
    {
      name: 'deploys.delete',
      class: 'mutation',
      description: 'Delete a non-published deploy. Netlify rejects deleting the currently-published deploy.',
      parameters: {
        type: 'object',
        properties: { deploy_id: { type: 'string' } },
        required: ['deploy_id'],
      },
      request: { method: 'DELETE', path: '/deploys/{deploy_id}' },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.env.create',
      class: 'mutation',
      description:
        'Create one or more environment variables on an account, optionally scoped to a single site and contexts.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          site_id: { type: 'string', description: 'Optional — when present, scopes the new vars to one site.' },
          variables: {
            type: 'array',
            description: 'Array of env-var entries to create.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                values: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                      context: {
                        type: 'string',
                        enum: ['all', 'dev', 'branch-deploy', 'deploy-preview', 'production'],
                      },
                      context_parameter: { type: 'string' },
                    },
                    required: ['value', 'context'],
                  },
                },
                is_secret: { type: 'boolean' },
                scopes: {
                  type: 'array',
                  items: { type: 'string', enum: ['builds', 'functions', 'runtime', 'post-processing'] },
                },
              },
              required: ['key', 'values'],
            },
          },
        },
        required: ['account_id', 'variables'],
      },
      request: {
        method: 'POST',
        path: '/accounts/{account_id}/env',
        query: { site_id: '{site_id}' },
        body: '{variables}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.env.update',
      class: 'mutation',
      description: 'Update an existing environment variable (replace its values + metadata).',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          key: { type: 'string' },
          site_id: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              values: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' },
                    context: { type: 'string' },
                    context_parameter: { type: 'string' },
                  },
                  required: ['value', 'context'],
                },
              },
              is_secret: { type: 'boolean' },
              scopes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['account_id', 'key', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/accounts/{account_id}/env/{key}',
        query: { site_id: '{site_id}' },
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'sites.env.delete',
      class: 'mutation',
      description: 'Delete an environment variable by key from an account (optionally scoped to a single site).',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string' },
          key: { type: 'string' },
          site_id: { type: 'string' },
        },
        required: ['account_id', 'key'],
      },
      request: {
        method: 'DELETE',
        path: '/accounts/{account_id}/env/{key}',
        query: { site_id: '{site_id}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
