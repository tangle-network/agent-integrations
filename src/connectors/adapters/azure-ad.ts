import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Entra ID (Azure Active Directory) connector backed by Microsoft Graph v1.0.
 *
 * Auth: OAuth2 (authorization code or client credentials) against the v2.0 endpoint.
 * The tenant id (`common`, `organizations`, or a directory id / verified domain) is
 * substituted into the authorize/token URLs at client-registration time when the
 * caller wants to scope the connection to a single tenant. The default endpoints
 * below use `common` so the same connector serves multi-tenant SaaS app registrations;
 * single-tenant operators override authorizationUrl/tokenUrl with their own tenant id.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/overview?view=graph-rest-1.0
 *   - https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow
 *   - https://learn.microsoft.com/graph/permissions-reference
 */
export const azureAdConnector = declarativeRestConnector({
  kind: 'azure-ad',
  displayName: 'Azure Active Directory',
  description:
    'Manage users, groups, and licenses in Microsoft Entra ID (Azure AD) via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'User.ReadWrite.All',
      'Group.ReadWrite.All',
      'GroupMember.ReadWrite.All',
      'Directory.ReadWrite.All',
      'User.ManageIdentities.All',
    ],
    clientIdEnv: 'AZURE_AD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'AZURE_AD_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    // ---------- Users ----------
    {
      name: 'users.list',
      class: 'read',
      description: 'List directory users with optional $filter, $select, $top, and $search.',
      parameters: {
        type: 'object',
        properties: {
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $top: { type: 'integer' },
          $search: { type: 'string' },
          $orderby: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: {
          $filter: '{$filter}',
          $select: '{$select}',
          $top: '{$top}',
          $search: '{$search}',
          $orderby: '{$orderby}',
        },
      },
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.list.enabled',
      class: 'read',
      description: 'List directory users whose accountEnabled flag is true.',
      parameters: {
        type: 'object',
        properties: {
          $select: { type: 'string' },
          $top: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: {
          $filter: 'accountEnabled eq true',
          $select: '{$select}',
          $top: '{$top}',
        },
      },
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a single user by id or userPrincipalName.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/users/{id}' },
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.create',
      class: 'mutation',
      description:
        'Create a new directory user. Requires accountEnabled, displayName, mailNickname, userPrincipalName, and passwordProfile.',
      parameters: {
        type: 'object',
        properties: {
          accountEnabled: { type: 'boolean' },
          displayName: { type: 'string' },
          mailNickname: { type: 'string' },
          userPrincipalName: { type: 'string' },
          passwordProfile: { type: 'object' },
          givenName: { type: 'string' },
          surname: { type: 'string' },
          jobTitle: { type: 'string' },
          department: { type: 'string' },
          usageLocation: { type: 'string' },
        },
        required: ['accountEnabled', 'displayName', 'mailNickname', 'userPrincipalName', 'passwordProfile'],
      },
      request: { method: 'POST', path: '/users', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Patch fields on an existing user.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['id', 'patch'],
      },
      request: { method: 'PATCH', path: '/users/{id}', body: '{patch}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete a directory user (moves to the deleted-items container for 30 days).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/users/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.revoke.sessions',
      class: 'mutation',
      description:
        'Invalidate all refresh tokens for a user, forcing reauthentication on every active session.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'POST', path: '/users/{id}/revokeSignInSessions' },
      cas: 'native-idempotency',
      requiredScopes: ['User.ReadWrite.All'],
    },
    {
      name: 'users.license.assign',
      class: 'mutation',
      description: 'Add or remove license SKUs assigned to a user.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          addLicenses: { type: 'array', items: { type: 'object' } },
          removeLicenses: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/users/{id}/assignLicense',
        body: { addLicenses: '{addLicenses}', removeLicenses: '{removeLicenses}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['User.ReadWrite.All', 'Directory.ReadWrite.All'],
    },

    // ---------- Groups ----------
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read a single group by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/groups/{id}' },
      requiredScopes: ['Group.ReadWrite.All'],
    },
    {
      name: 'groups.attributes.get',
      class: 'read',
      description: 'Read custom security attributes assigned to a group.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/groups/{id}',
        query: { $select: 'customSecurityAttributes' },
      },
      requiredScopes: ['Group.ReadWrite.All', 'CustomSecAttributeAssignment.ReadWrite.All'],
    },
    {
      name: 'groups.attributes.reset',
      class: 'mutation',
      description:
        'Clear custom security attributes on a group by patching customSecurityAttributes to an empty object.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          customSecurityAttributes: { type: 'object' },
        },
        required: ['id', 'customSecurityAttributes'],
      },
      request: {
        method: 'PATCH',
        path: '/groups/{id}',
        body: { customSecurityAttributes: '{customSecurityAttributes}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Group.ReadWrite.All', 'CustomSecAttributeAssignment.ReadWrite.All'],
    },
    {
      name: 'groups.create',
      class: 'mutation',
      description:
        'Create a new group. Microsoft 365 groups require groupTypes:["Unified"]; security groups omit it.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          mailNickname: { type: 'string' },
          description: { type: 'string' },
          securityEnabled: { type: 'boolean' },
          mailEnabled: { type: 'boolean' },
          groupTypes: { type: 'array', items: { type: 'string' } },
          owners: { type: 'array', items: { type: 'string' } },
          members: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string' },
        },
        required: ['displayName', 'mailNickname', 'securityEnabled', 'mailEnabled'],
      },
      request: { method: 'POST', path: '/groups', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['Group.ReadWrite.All'],
    },
    {
      name: 'groups.delete',
      class: 'mutation',
      description: 'Delete a group (Microsoft 365 groups move to a 30-day soft-delete container).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/groups/{id}' },
      cas: 'native-idempotency',
      requiredScopes: ['Group.ReadWrite.All'],
    },
    {
      name: 'groups.members.list',
      class: 'read',
      description: 'List the direct members of a group.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          $select: { type: 'string' },
          $top: { type: 'integer' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/groups/{id}/members',
        query: { $select: '{$select}', $top: '{$top}' },
      },
      requiredScopes: ['GroupMember.ReadWrite.All', 'Group.ReadWrite.All'],
    },
    {
      name: 'groups.members.add',
      class: 'mutation',
      description:
        'Add a directory object as a member of the group. The @odata.id payload references the user/group/service-principal by id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          memberId: { type: 'string' },
        },
        required: ['id', 'memberId'],
      },
      request: {
        method: 'POST',
        path: '/groups/{id}/members/$ref',
        body: { '@odata.id': 'https://graph.microsoft.com/v1.0/directoryObjects/{memberId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['GroupMember.ReadWrite.All', 'Group.ReadWrite.All'],
    },
  ],
})
