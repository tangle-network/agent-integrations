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
    {
      name: 'pulls.create',
      class: 'mutation',
      description: 'Open a pull request from `head` into `base` on the target repository.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          head: {
            type: 'string',
            description: 'Branch (or cross-fork ref like `octocat:feature-x`) containing the changes.',
          },
          base: { type: 'string', description: 'Branch in the target repo to merge into (e.g. `main`).' },
          body: { type: 'string', description: 'PR description body (markdown).' },
          draft: { type: 'boolean', description: 'When true, open the PR as a draft.' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
      request: { method: 'POST', path: '/repos/{owner}/{repo}/pulls', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'pulls.merge',
      class: 'mutation',
      description: 'Merge a pull request by number. `merge_method` selects merge | squash | rebase.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          commit_title: { type: 'string', description: 'Optional commit title for the merge commit.' },
          merge_method: {
            type: 'string',
            enum: ['merge', 'squash', 'rebase'],
            description: 'Merge strategy. Defaults to `merge` on GitHub.',
          },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
      request: { method: 'PUT', path: '/repos/{owner}/{repo}/pulls/{pull_number}/merge', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'issues.createComment',
      class: 'mutation',
      description: 'Add a comment to an existing issue or pull request.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issue_number: { type: 'integer' },
          body: { type: 'string', description: 'Comment body (markdown).' },
        },
        required: ['owner', 'repo', 'issue_number', 'body'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/issues/{issue_number}/comments',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'pulls.reviews.create',
      class: 'mutation',
      description: 'Submit a review on a pull request: approve, request changes, or comment.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pull_number: { type: 'integer' },
          event: {
            type: 'string',
            enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
            description: 'Review action to submit.',
          },
          body: {
            type: 'string',
            description: 'Optional review body. Required by GitHub when `event` is REQUEST_CHANGES or COMMENT.',
          },
        },
        required: ['owner', 'repo', 'pull_number', 'event'],
      },
      request: {
        method: 'POST',
        path: '/repos/{owner}/{repo}/pulls/{pull_number}/reviews',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
