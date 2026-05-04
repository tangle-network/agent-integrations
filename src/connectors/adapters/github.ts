import { declarativeRestConnector } from './declarative-rest.js'

const repoParams = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    repo: { type: 'string' },
  },
  required: ['owner', 'repo'],
}

export const githubConnector = declarativeRestConnector({
  kind: 'github',
  displayName: 'GitHub',
  description: 'Search repositories/issues and create or update GitHub issues through a user-scoped token.',
  auth: { kind: 'api-key', hint: 'GitHub fine-grained personal access token or installation token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.github.com',
  defaultHeaders: {
    'x-github-api-version': '2022-11-28',
  },
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'repositories.get',
      class: 'read',
      description: 'Read repository metadata.',
      parameters: repoParams,
      request: { method: 'GET', path: '/repos/{owner}/{repo}' },
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search GitHub issues and pull requests.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['q'],
      },
      request: { method: 'GET', path: '/search/issues', query: { q: '{q}', per_page: '{per_page}' } },
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
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['owner', 'repo', 'title'],
      },
      request: { method: 'POST', path: '/repos/{owner}/{repo}/issues', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update an issue by number.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed'] },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
      request: { method: 'PATCH', path: '/repos/{owner}/{repo}/issues/{issue_number}', body: 'args' },
      cas: 'etag-if-match',
    },
  ],
})
