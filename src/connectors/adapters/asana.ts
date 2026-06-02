import { declarativeRestConnector } from './declarative-rest.js'

export const asanaConnector = declarativeRestConnector({
  kind: 'asana',
  displayName: 'Asana',
  description: 'Search projects/tasks and create or update Asana tasks.',
  auth: { kind: 'api-key', hint: 'Asana personal access token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.asana.com/api/1.0',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'projects.search',
      class: 'read',
      description: 'List or search projects in a workspace.',
      parameters: {
        type: 'object',
        properties: { workspace: { type: 'string' }, archived: { type: 'boolean' }, limit: { type: 'integer' } },
        required: ['workspace'],
      },
      request: { method: 'GET', path: '/projects', query: { workspace: '{workspace}', archived: '{archived}', limit: '{limit}' } },
    },
    {
      name: 'tasks.search',
      class: 'read',
      description: 'Search tasks in a workspace.',
      parameters: {
        type: 'object',
        properties: { workspace: { type: 'string' }, text: { type: 'string' }, limit: { type: 'integer' } },
        required: ['workspace'],
      },
      request: { method: 'GET', path: '/workspaces/{workspace}/tasks/search', query: { text: '{text}', limit: '{limit}' } },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create an Asana task.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      request: { method: 'POST', path: '/tasks', body: { data: '{data}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an Asana task.',
      parameters: {
        type: 'object',
        properties: { taskGid: { type: 'string' }, data: { type: 'object' } },
        required: ['taskGid', 'data'],
      },
      request: { method: 'PUT', path: '/tasks/{taskGid}', body: { data: '{data}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.addComment',
      class: 'mutation',
      description: 'Add a comment story to an Asana task. Comments are exposed as Asana stories with type=comment.',
      parameters: {
        type: 'object',
        properties: {
          taskGid: { type: 'string', description: 'Asana task gid.' },
          text: { type: 'string', description: 'Comment body as plain text.' },
        },
        required: ['taskGid', 'text'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{taskGid}/stories',
        body: { data: { text: '{text}', type: 'comment' } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tasks.complete',
      class: 'mutation',
      description: 'Mark an Asana task as completed. Idempotent: setting completed=true twice converges on the same state.',
      parameters: {
        type: 'object',
        properties: {
          taskGid: { type: 'string', description: 'Asana task gid.' },
        },
        required: ['taskGid'],
      },
      request: {
        method: 'PUT',
        path: '/tasks/{taskGid}',
        body: { data: { completed: true } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
