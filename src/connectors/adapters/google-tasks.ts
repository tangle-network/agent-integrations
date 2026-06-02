import { declarativeRestConnector } from './declarative-rest.js'

export const googleTasksConnector = declarativeRestConnector({
  kind: 'google-tasks',
  displayName: 'Google Tasks',
  description: 'Manage tasks in Google Tasks task lists.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/tasks'],
    clientIdEnv: 'GOOGLE_TASKS_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_TASKS_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://tasks.googleapis.com/tasks/v1',
  test: { method: 'GET', path: '/users/@me/lists' },
  capabilities: [
    {
      name: 'tasklists.list',
      class: 'read',
      description: 'List all task lists.',
      parameters: {
        type: 'object',
        properties: { maxResults: { type: 'integer' } },
        required: [],
      },
      request: { method: 'GET', path: '/users/@me/lists', query: { maxResults: '{maxResults}' } },
    },
    {
      name: 'tasklists.get',
      class: 'read',
      description: 'Get a specific task list.',
      parameters: {
        type: 'object',
        properties: { tasklistId: { type: 'string' } },
        required: ['tasklistId'],
      },
      request: { method: 'GET', path: '/users/@me/lists/{tasklistId}' },
    },
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List tasks in a task list.',
      parameters: {
        type: 'object',
        properties: { tasklistId: { type: 'string' }, maxResults: { type: 'integer' }, showCompleted: { type: 'boolean' } },
        required: ['tasklistId'],
      },
      request: { method: 'GET', path: '/users/@me/lists/{tasklistId}/tasks', query: { maxResults: '{maxResults}', showCompleted: '{showCompleted}' } },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Get a specific task.',
      parameters: {
        type: 'object',
        properties: { tasklistId: { type: 'string' }, taskId: { type: 'string' } },
        required: ['tasklistId', 'taskId'],
      },
      request: { method: 'GET', path: '/users/@me/lists/{tasklistId}/tasks/{taskId}' },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a new task in a task list.',
      parameters: {
        type: 'object',
        properties: {
          tasklistId: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
          dueDate: { type: 'string' },
          parent: { type: 'string' },
        },
        required: ['tasklistId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/users/@me/lists/{tasklistId}/tasks',
        body: { title: '{title}', notes: '{notes}', dueDate: '{dueDate}', parent: '{parent}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an existing task.',
      parameters: {
        type: 'object',
        properties: {
          tasklistId: { type: 'string' },
          taskId: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
          dueDate: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['tasklistId', 'taskId'],
      },
      request: {
        method: 'PATCH',
        path: '/users/@me/lists/{tasklistId}/tasks/{taskId}',
        body: { title: '{title}', notes: '{notes}', dueDate: '{dueDate}', status: '{status}' },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'tasks.delete',
      class: 'mutation',
      description: 'Delete a task.',
      parameters: {
        type: 'object',
        properties: { tasklistId: { type: 'string' }, taskId: { type: 'string' } },
        required: ['tasklistId', 'taskId'],
      },
      request: { method: 'DELETE', path: '/users/@me/lists/{tasklistId}/tasks/{taskId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tasks.complete',
      class: 'mutation',
      description:
        'Mark a task as completed. Issues a PATCH against the task with status="completed"; Google records `completed` as the current time. To uncomplete, use tasks.update with status="needsAction".',
      parameters: {
        type: 'object',
        properties: {
          tasklistId: { type: 'string', description: 'Containing task list ID.' },
          taskId: { type: 'string', description: 'Task ID to mark complete.' },
        },
        required: ['tasklistId', 'taskId'],
      },
      request: {
        method: 'PATCH',
        path: '/users/@me/lists/{tasklistId}/tasks/{taskId}',
        body: { status: 'completed' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new task list owned by the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Display title of the new task list.' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/users/@me/lists',
        body: { title: '{title}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
