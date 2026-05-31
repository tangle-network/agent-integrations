import { declarativeRestConnector } from './declarative-rest.js'

export const everhourConnector = declarativeRestConnector({
  kind: 'everhour',
  displayName: 'Everhour',
  description: 'Time tracking software that integrates into project management tools to track billable hours, set budgets, and monitor spending.',
  auth: { kind: 'api-key', hint: 'Everhour API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.everhour.com/api',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task in Everhour.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'The ID of the project to create the task in.' },
          name: { type: 'string', description: 'The name of the task.' },
        },
        required: ['projectId', 'name'],
      },
      request: { method: 'POST', path: '/projects/{projectId}/tasks', body: { name: '{name}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'timers.start',
      class: 'mutation',
      description: 'Start a timer for a task in Everhour.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to start the timer for.' },
        },
        required: ['taskId'],
      },
      request: { method: 'POST', path: '/tasks/{taskId}/timer', body: {} },
      cas: 'native-idempotency',
    },
    {
      name: 'timers.stop',
      class: 'mutation',
      description: 'Stop the timer for a task in Everhour.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task to stop the timer for.' },
        },
        required: ['taskId'],
      },
      request: { method: 'DELETE', path: '/tasks/{taskId}/timer' },
      cas: 'native-idempotency',
    },
  ],
})
