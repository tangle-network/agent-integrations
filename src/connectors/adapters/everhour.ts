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
    {
      name: 'time.create',
      class: 'mutation',
      description: 'Log a time entry against an Everhour task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task the time entry attaches to.' },
          time: { type: 'integer', description: 'Duration in seconds.' },
          date: { type: 'string', description: 'Date the entry is logged for (YYYY-MM-DD).' },
          user: { type: 'integer', description: 'Optional user id; defaults to the authorised account.' },
          comment: { type: 'string', description: 'Optional free-form comment for the entry.' },
        },
        required: ['taskId', 'time', 'date'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{taskId}/time',
        body: {
          time: '{time}',
          date: '{date}',
          user: '{user}',
          comment: '{comment}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'time.update',
      class: 'mutation',
      description: 'Update an existing Everhour time entry.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task the entry belongs to.' },
          timeId: { type: 'string', description: 'The ID of the time entry to update.' },
          time: { type: 'integer', description: 'Updated duration in seconds.' },
          date: { type: 'string', description: 'Updated date (YYYY-MM-DD).' },
          comment: { type: 'string', description: 'Updated comment.' },
        },
        required: ['taskId', 'timeId'],
      },
      request: {
        method: 'PUT',
        path: '/tasks/{taskId}/time/{timeId}',
        body: {
          time: '{time}',
          date: '{date}',
          comment: '{comment}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'time.delete',
      class: 'mutation',
      description: 'Delete an Everhour time entry.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the task the entry belongs to.' },
          timeId: { type: 'string', description: 'The ID of the time entry to delete.' },
        },
        required: ['taskId', 'timeId'],
      },
      request: {
        method: 'DELETE',
        path: '/tasks/{taskId}/time/{timeId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
