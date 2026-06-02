import { declarativeRestConnector } from './declarative-rest.js'

export const niftyConnector = declarativeRestConnector({
  kind: 'nifty',
  displayName: 'Nifty',
  description: 'Project management made simple. Create and manage tasks in Nifty.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.nifty.com/oauth/authorize',
    tokenUrl: 'https://api.nifty.com/oauth/token',
    scopes: ['tasks:write', 'tasks:read'],
    clientIdEnv: 'NIFTY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NIFTY_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.nifty.com/v1',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task in Nifty.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assignee_id: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          due_date: { type: 'string' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/tasks',
        body: {
          title: '{title}',
          description: '{description}',
          assignee_id: '{assignee_id}',
          status: '{status}',
          priority: '{priority}',
          due_date: '{due_date}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['tasks:write'],
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description:
        'Update an existing task in Nifty. `taskId` is required; any provided field replaces the current value. Use `assignee_ids: []` to clear assignees.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Nifty task id (URL path).' },
          name: { type: 'string' },
          description: { type: 'string' },
          milestone_id: { type: 'string' },
          assignee_ids: { type: 'array', items: { type: 'string' } },
          due_date: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'PUT',
        path: '/tasks/{taskId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['tasks:write'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description:
        'Create a comment on a Nifty task. `object_id` is the task id; `object_type` is fixed to `Task`.',
      parameters: {
        type: 'object',
        properties: {
          object_id: { type: 'string', description: 'Task id to attach the comment to.' },
          content: { type: 'string', description: 'Comment body.' },
        },
        required: ['object_id', 'content'],
      },
      request: {
        method: 'POST',
        path: '/comments',
        body: {
          object_type: 'Task',
          object_id: '{object_id}',
          content: '{content}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['tasks:write'],
    },
  ],
})
