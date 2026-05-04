import { declarativeRestConnector } from './declarative-rest.js'

export const gitlabConnector = declarativeRestConnector({
  kind: 'gitlab',
  displayName: 'GitLab',
  description: 'Search GitLab projects/issues and create or update issues through a personal, project, or group token.',
  auth: { kind: 'api-key', hint: 'GitLab access token with api/read_api scope.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://gitlab.com/api/v4' },
  credentialPlacement: { kind: 'header', header: 'PRIVATE-TOKEN' },
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'projects.search',
      class: 'read',
      description: 'Search projects visible to the token.',
      parameters: {
        type: 'object',
        properties: { search: { type: 'string' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['search'],
      },
      request: { method: 'GET', path: '/projects', query: { search: '{search}', per_page: '{per_page}' } },
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search issues in a project.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' }, search: { type: 'string' }, per_page: { type: 'integer' } },
        required: ['projectId', 'search'],
      },
      request: { method: 'GET', path: '/projects/{projectId}/issues', query: { search: '{search}', per_page: '{per_page}' } },
    },
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create a GitLab project issue.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
        required: ['projectId', 'title'],
      },
      request: { method: 'POST', path: '/projects/{projectId}/issues', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update a GitLab issue.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' }, issueIid: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, state_event: { type: 'string' } },
        required: ['projectId', 'issueIid'],
      },
      request: { method: 'PUT', path: '/projects/{projectId}/issues/{issueIid}', body: 'args' },
      cas: 'etag-if-match',
    },
  ],
})
