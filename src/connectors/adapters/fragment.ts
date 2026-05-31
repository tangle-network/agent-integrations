import { declarativeRestConnector } from './declarative-rest.js'

export const fragmentConnector = declarativeRestConnector({
  kind: 'fragment',
  displayName: 'Fragment',
  description:
    'Create, read, update, list, and delete tasks in Fragment (api.onfragment.com).',
  auth: {
    kind: 'api-key',
    hint: 'Fragment API token from app.onfragment.com/settings/account/developers (sent as Bearer).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.onfragment.com/api/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'GET', path: '/tasks', query: { limit: '1' } },
  capabilities: [
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List tasks, optionally filtered by status, assignee, and capped by limit.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: "Filter tasks by status (e.g. 'open', 'completed', 'cancelled')." },
          assignee_uid: { type: 'string', description: 'Filter tasks by assignee email or ID.' },
          limit: { type: 'integer', description: 'Maximum number of tasks to return (default 50).' },
        },
      },
      request: {
        method: 'GET',
        path: '/tasks',
        query: {
          status: '{status}',
          assignee_uid: '{assignee_uid}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Fetch a single task by its Fragment task UID.',
      parameters: {
        type: 'object',
        properties: {
          task_uid: { type: 'string', description: 'Unique identifier of the task.' },
        },
        required: ['task_uid'],
      },
      request: { method: 'GET', path: '/tasks/{task_uid}' },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a new task in Fragment.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The title of the task.' },
          url: { type: 'string', description: 'A URL associated with the task (e.g., link to a ticket or resource).' },
          due_at: { type: 'string', description: 'When the task is due (ISO-8601 timestamp).' },
          assignee_email: { type: 'string', description: 'Email of the person to assign this task to.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to categorize the task.' },
          fields: { type: 'object', description: 'Additional custom fields for the task.' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/tasks',
        body: {
          title: '{title}',
          url: '{url}',
          due_at: '{due_at}',
          assignee_email: '{assignee_email}',
          tags: '{tags}',
          fields: '{fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an existing Fragment task by UID.',
      parameters: {
        type: 'object',
        properties: {
          task_uid: { type: 'string', description: 'Unique identifier of the task to update.' },
          due_at: { type: 'string', description: 'New due date (ISO-8601 timestamp).' },
          status: { type: 'string', description: "New status (e.g. 'open', 'completed', 'cancelled')." },
          assignee_email: { type: 'string', description: 'Email of the person to assign this task to.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
          fields: { type: 'object', description: 'Replacement custom-field map (merged on the server).' },
        },
        required: ['task_uid'],
      },
      request: {
        method: 'PATCH',
        path: '/tasks/{task_uid}',
        body: {
          due_at: '{due_at}',
          status: '{status}',
          assignee_email: '{assignee_email}',
          tags: '{tags}',
          fields: '{fields}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.delete',
      class: 'mutation',
      description: 'Delete a Fragment task by UID.',
      parameters: {
        type: 'object',
        properties: {
          task_uid: { type: 'string', description: 'Unique identifier of the task to delete.' },
        },
        required: ['task_uid'],
      },
      request: { method: 'DELETE', path: '/tasks/{task_uid}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
