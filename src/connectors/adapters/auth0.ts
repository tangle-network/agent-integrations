import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Auth0 Management API connector.
 *
 * Auth0 tenants are per-customer subdomains (e.g. https://acme.us.auth0.com).
 * The tenant base URL is supplied at connection time via metadata.tenantDomain
 * (full origin, no trailing slash) so the same adapter works for every tenant
 * without a per-tenant build.
 *
 * Authorization: OAuth2 with the Management API as the audience. The tenant
 * authorization/token URLs are tenant-scoped; the global EU/US/AU/JP regions
 * all share the same /authorize and /oauth/token path shape so we cannot bake
 * one regional host into the connector. We point at Auth0's documented global
 * "guardian" host — operators MUST override authorizationUrl/tokenUrl at
 * client-registration time with the tenant's own URLs (the platform stores
 * them as part of the OAuth client). The values below are the canonical
 * documented shapes Auth0 publishes for the M2M (machine-to-machine) and
 * authorization-code flows against the Management API.
 *
 * Docs:
 *   - https://auth0.com/docs/api/management/v2
 *   - https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens
 *   - https://auth0.com/docs/api/authentication#client-credentials-flow
 */
export const auth0Connector = declarativeRestConnector({
  kind: 'auth0',
  displayName: 'Auth0',
  description:
    'Manage Auth0 tenants: users, roles, organizations, connections, clients, and grants via the Management API v2.',
  auth: {
    kind: 'oauth2',
    // Tenant-scoped at registration time. The default host below is Auth0's
    // generic guardian endpoint; the operator overrides it with the tenant's
    // own https://{tenant}.{region}.auth0.com origin when creating the
    // OAuth client record.
    authorizationUrl: 'https://auth0.auth0.com/authorize',
    tokenUrl: 'https://auth0.auth0.com/oauth/token',
    scopes: [
      'read:users',
      'update:users',
      'create:users',
      'delete:users',
      'read:roles',
      'update:roles',
      'create:roles',
      'delete:roles',
      'read:role_members',
      'create:role_members',
      'delete:role_members',
      'read:organizations',
      'create:organizations',
      'update:organizations',
      'delete:organizations',
      'read:organization_members',
      'create:organization_members',
      'delete:organization_members',
      'read:clients',
      'update:clients',
      'create:clients',
      'delete:clients',
      'read:connections',
      'update:connections',
      'create:connections',
      'delete:connections',
      'read:grants',
      'delete:grants',
      'read:logs',
    ],
    clientIdEnv: 'AUTH0_OAUTH_CLIENT_ID',
    clientSecretEnv: 'AUTH0_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'tenantDomain' },
  test: { method: 'GET', path: '/api/v2/stats/active-users' },
  capabilities: [
    // ---------- Users ----------
    {
      name: 'users.list',
      class: 'read',
      description: 'List Auth0 users with optional Lucene query, pagination, and sort.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Lucene search query (e.g. email:"a@b.com").' },
          page: { type: 'number' },
          per_page: { type: 'number' },
          sort: { type: 'string' },
          search_engine: { type: 'string', enum: ['v3'] },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/users',
        query: {
          q: '{q}',
          page: '{page}',
          per_page: '{per_page}',
          sort: '{sort}',
          search_engine: '{search_engine}',
          include_totals: 'true',
        },
      },
      requiredScopes: ['read:users'],
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a single Auth0 user by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/users/{id}' },
      requiredScopes: ['read:users'],
    },
    {
      name: 'users.create',
      class: 'mutation',
      description:
        'Create a new user in a specified connection. Email or phone_number is required by Auth0 depending on connection type.',
      parameters: {
        type: 'object',
        properties: {
          connection: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          password: { type: 'string' },
          email_verified: { type: 'boolean' },
          phone_verified: { type: 'boolean' },
          user_metadata: { type: 'object' },
          app_metadata: { type: 'object' },
          given_name: { type: 'string' },
          family_name: { type: 'string' },
          name: { type: 'string' },
          nickname: { type: 'string' },
          username: { type: 'string' },
          blocked: { type: 'boolean' },
        },
        required: ['connection'],
      },
      request: { method: 'POST', path: '/api/v2/users', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['create:users'],
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Patch fields on an existing user (metadata, blocked, email, etc.).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
      request: { method: 'PATCH', path: '/api/v2/users/{id}', body: '{patch}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['update:users'],
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete an Auth0 user.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/api/v2/users/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['delete:users'],
    },
    {
      name: 'users.roles.list',
      class: 'read',
      description: 'List roles assigned to a user.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/users/{id}/roles' },
      requiredScopes: ['read:users', 'read:roles'],
    },
    {
      name: 'users.roles.assign',
      class: 'mutation',
      description: 'Assign one or more roles to a user.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'roles'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/users/{id}/roles',
        body: { roles: '{roles}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['update:users', 'create:role_members'],
    },
    {
      name: 'users.roles.remove',
      class: 'mutation',
      description: 'Remove one or more roles from a user.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'roles'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v2/users/{id}/roles',
        body: { roles: '{roles}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['update:users', 'delete:role_members'],
    },

    // ---------- Roles ----------
    {
      name: 'roles.list',
      class: 'read',
      description: 'List roles in the tenant.',
      parameters: {
        type: 'object',
        properties: {
          name_filter: { type: 'string' },
          page: { type: 'number' },
          per_page: { type: 'number' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/roles',
        query: {
          name_filter: '{name_filter}',
          page: '{page}',
          per_page: '{per_page}',
          include_totals: 'true',
        },
      },
      requiredScopes: ['read:roles'],
    },
    {
      name: 'roles.get',
      class: 'read',
      description: 'Read a single role by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/roles/{id}' },
      requiredScopes: ['read:roles'],
    },
    {
      name: 'roles.create',
      class: 'mutation',
      description: 'Create a new role.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/api/v2/roles', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['create:roles'],
    },
    {
      name: 'roles.update',
      class: 'mutation',
      description: 'Patch a role.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
      request: { method: 'PATCH', path: '/api/v2/roles/{id}', body: '{patch}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['update:roles'],
    },
    {
      name: 'roles.delete',
      class: 'mutation',
      description: 'Delete a role.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/api/v2/roles/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['delete:roles'],
    },

    // ---------- Organizations ----------
    {
      name: 'organizations.list',
      class: 'read',
      description: 'List organizations in the tenant.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          per_page: { type: 'number' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/organizations',
        query: {
          page: '{page}',
          per_page: '{per_page}',
          include_totals: 'true',
        },
      },
      requiredScopes: ['read:organizations'],
    },
    {
      name: 'organizations.get',
      class: 'read',
      description: 'Read a single organization by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/organizations/{id}' },
      requiredScopes: ['read:organizations'],
    },
    {
      name: 'organizations.create',
      class: 'mutation',
      description: 'Create a new organization.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          display_name: { type: 'string' },
          branding: { type: 'object' },
          metadata: { type: 'object' },
          enabled_connections: { type: 'array' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/api/v2/organizations', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['create:organizations'],
    },
    {
      name: 'organizations.update',
      class: 'mutation',
      description: 'Patch an organization.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
      request: { method: 'PATCH', path: '/api/v2/organizations/{id}', body: '{patch}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['update:organizations'],
    },
    {
      name: 'organizations.delete',
      class: 'mutation',
      description: 'Delete an organization.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/api/v2/organizations/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['delete:organizations'],
    },
    {
      name: 'organizations.members.list',
      class: 'read',
      description: 'List members of an organization.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/organizations/{id}/members' },
      requiredScopes: ['read:organization_members'],
    },
    {
      name: 'organizations.members.add',
      class: 'mutation',
      description: 'Add members (by user_id) to an organization.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'members'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/organizations/{id}/members',
        body: { members: '{members}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['create:organization_members'],
    },
    {
      name: 'organizations.members.remove',
      class: 'mutation',
      description: 'Remove members from an organization.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          members: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'members'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v2/organizations/{id}/members',
        body: { members: '{members}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['delete:organization_members'],
    },

    // ---------- Connections (identity providers) ----------
    {
      name: 'connections.list',
      class: 'read',
      description: 'List connections (database, social, enterprise) configured on the tenant.',
      parameters: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          page: { type: 'number' },
          per_page: { type: 'number' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/connections',
        query: {
          strategy: '{strategy}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['read:connections'],
    },
    {
      name: 'connections.get',
      class: 'read',
      description: 'Read a single connection by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/connections/{id}' },
      requiredScopes: ['read:connections'],
    },

    // ---------- Clients (applications) ----------
    {
      name: 'clients.list',
      class: 'read',
      description: 'List applications (M2M, SPA, regular web, native) registered on the tenant.',
      parameters: {
        type: 'object',
        properties: {
          app_type: { type: 'string' },
          is_global: { type: 'boolean' },
          page: { type: 'number' },
          per_page: { type: 'number' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/clients',
        query: {
          app_type: '{app_type}',
          is_global: '{is_global}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['read:clients'],
    },
    {
      name: 'clients.get',
      class: 'read',
      description: 'Read a single client/application by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/api/v2/clients/{id}' },
      requiredScopes: ['read:clients'],
    },

    // ---------- Grants ----------
    {
      name: 'grants.list',
      class: 'read',
      description: 'List user grants (consented scopes) for the tenant.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          client_id: { type: 'string' },
          audience: { type: 'string' },
          page: { type: 'number' },
          per_page: { type: 'number' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/grants',
        query: {
          user_id: '{user_id}',
          client_id: '{client_id}',
          audience: '{audience}',
          page: '{page}',
          per_page: '{per_page}',
          include_totals: 'true',
        },
      },
      requiredScopes: ['read:grants'],
    },
    {
      name: 'grants.revoke',
      class: 'mutation',
      description: 'Revoke a grant (delete by id).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/api/v2/grants/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['delete:grants'],
    },

    // ---------- Logs ----------
    {
      name: 'logs.search',
      class: 'read',
      description: 'Search tenant logs with a Lucene query (failed logins, signups, admin actions, etc.).',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          from: { type: 'string' },
          take: { type: 'number' },
          sort: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/logs',
        query: {
          q: '{q}',
          from: '{from}',
          take: '{take}',
          sort: '{sort}',
          include_totals: 'true',
        },
      },
      requiredScopes: ['read:logs'],
    },
  ],
})
