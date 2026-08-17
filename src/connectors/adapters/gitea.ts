import { declarativeRestConnector } from './declarative-rest.js'

export const giteaConnector = declarativeRestConnector({
  kind: 'gitea',
  displayName: 'Gitea',
  description: 'Self-hosted Git service for creating and managing repositories, issues, and pull requests.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: '{instanceUrl}/login/oauth/authorize',
    tokenUrl: '{instanceUrl}/login/oauth/access_token',
    scopes: [
      'read:user',
      'write:user',
      'read:issue',
      'write:issue',
      'read:repository',
      'write:repository',
    ],
    clientIdEnv: 'GITEA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITEA_OAUTH_CLIENT_SECRET',
    pkce: 'supported',
    urlTemplateMetadata: {
      instanceUrl: {
        kind: 'base-url',
        requirePublicHttps: true,
      },
    },
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  requirePublicHttpsBaseUrl: true,
  test: { method: 'GET', path: '/api/v1/user' },
  capabilities: [
    {
      name: 'repos.list',
      class: 'read',
      description: 'List repositories.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['owner'],
      },
      request: { method: 'GET', path: '/api/v1/users/{owner}/repos', query: { limit: '{limit}' } },
      requiredScopes: ['read:user'],
    },
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create an issue in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          assignee: { type: 'string' },
          labels: { type: 'array' },
        },
        required: ['owner', 'repo', 'title'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/repos/{owner}/{repo}/issues',
        body: {
          title: '{title}',
          body: '{body}',
          assignee: '{assignee}',
          labels: '{labels}',
        }
      },
      cas: 'native-idempotency',
      requiredScopes: ['write:issue'],
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update an issue in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          index: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string' },
          state: { type: 'string' },
        },
        required: ['owner', 'repo', 'index'],
      },
      request: {
        method: 'PATCH',
        path: '/api/v1/repos/{owner}/{repo}/issues/{index}',
        body: {
          title: '{title}',
          body: '{body}',
          state: '{state}',
        }
      },
      cas: 'etag-if-match',
      requiredScopes: ['write:issue'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Create a comment on an issue or pull request.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          index: { type: 'integer' },
          body: { type: 'string' },
        },
        required: ['owner', 'repo', 'index', 'body'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/repos/{owner}/{repo}/issues/{index}/comments',
        body: { body: '{body}' }
      },
      cas: 'native-idempotency',
      requiredScopes: ['write:issue'],
    },
    {
      name: 'pull-requests.list',
      class: 'read',
      description: 'List pull requests in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/repos/{owner}/{repo}/pulls',
        query: { state: '{state}', limit: '{limit}' }
      },
      requiredScopes: ['read:repository'],
    },
    {
      name: 'pull-requests.create',
      class: 'mutation',
      description: 'Create a pull request in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/repos/{owner}/{repo}/pulls',
        body: {
          title: '{title}',
          body: '{body}',
          head: '{head}',
          base: '{base}',
        }
      },
      cas: 'native-idempotency',
      requiredScopes: ['write:repository'],
    },
    {
      name: 'branches.list',
      class: 'read',
      description: 'List branches in a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/repos/{owner}/{repo}/branches',
      },
      requiredScopes: ['read:repository'],
    },
    {
      name: 'repos.create',
      class: 'mutation',
      description: 'Create a repository owned by the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          private: { type: 'boolean' },
          auto_init: { type: 'boolean' },
          default_branch: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/user/repos',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write:user'],
    },
    {
      name: 'repos.delete',
      class: 'mutation',
      description: 'Delete a repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
        },
        required: ['owner', 'repo'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/repos/{owner}/{repo}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write:repository'],
    },
    {
      name: 'pull-requests.merge',
      class: 'mutation',
      description: 'Merge a pull request.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          index: { type: 'integer' },
          Do: { type: 'string', enum: ['merge', 'rebase', 'rebase-merge', 'squash'] },
          MergeTitleField: { type: 'string' },
          MergeMessageField: { type: 'string' },
        },
        required: ['owner', 'repo', 'index'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/repos/{owner}/{repo}/pulls/{index}/merge',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write:repository'],
    },
  ],
})
