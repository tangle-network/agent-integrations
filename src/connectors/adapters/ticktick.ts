import { declarativeRestConnector } from './declarative-rest.js'

export const ticktickConnector = declarativeRestConnector({
  kind: 'ticktick',
  displayName: 'TickTick',
  description: 'Create, update, complete, and delete tasks in TickTick.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://ticktick.com/oauth/authorize',
    tokenUrl: 'https://ticktick.com/oauth/token',
    scopes: ['tasks:read', 'tasks:write'],
    clientIdEnv: 'TICKTICK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TICKTICK_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.ticktick.com/v2',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a new task in TickTick.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          projectId: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'integer' },
          dueDate: { type: 'string' },
        },
        required: ['title', 'projectId'],
      },
      request: {
        method: 'POST',
        path: '/task',
        body: {
          title: '{title}',
          projectId: '{projectId}',
          description: '{description}',
          priority: '{priority}',
          dueDate: '{dueDate}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an existing task in TickTick.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'integer' },
          dueDate: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'POST',
        path: '/task/{taskId}',
        body: {
          title: '{title}',
          description: '{description}',
          priority: '{priority}',
          dueDate: '{dueDate}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Retrieve a specific task from TickTick.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/task/{taskId}',
      },
    },
    {
      name: 'tasks.find',
      class: 'read',
      description: 'Find tasks in a TickTick project by query.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/project/{projectId}/tasks',
        query: {
          q: '{query}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'tasks.complete',
      class: 'mutation',
      description: 'Mark a task as complete in TickTick.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'POST',
        path: '/task/{taskId}/complete',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.delete',
      class: 'mutation',
      description: 'Delete a task from TickTick.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'DELETE',
        path: '/task/{taskId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Retrieve a specific project from TickTick.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/project/{projectId}',
      },
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new project (list) in TickTick.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex color code for the project (optional).' },
          viewMode: { type: 'string', description: "View mode, e.g. 'list', 'kanban', 'timeline' (optional)." },
          kind: { type: 'string', description: "Project kind, e.g. 'TASK' or 'NOTE' (optional)." },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/project',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'projects.update',
      class: 'mutation',
      description: 'Update an existing project in TickTick.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string', description: 'New project name (optional).' },
          color: { type: 'string', description: 'Hex color code for the project (optional).' },
          viewMode: { type: 'string', description: 'View mode (optional).' },
          kind: { type: 'string', description: 'Project kind (optional).' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'POST',
        path: '/project/{projectId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'projects.delete',
      class: 'mutation',
      description: 'Delete a project from TickTick.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'DELETE',
        path: '/project/{projectId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tasks.move',
      class: 'mutation',
      description: 'Move a task to another project.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          projectId: { type: 'string', description: 'Destination project ID.' },
        },
        required: ['taskId', 'projectId'],
      },
      request: {
        method: 'POST',
        path: '/task/{taskId}/move',
        body: {
          projectId: '{projectId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
