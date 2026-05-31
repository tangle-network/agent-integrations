import { declarativeRestConnector } from './declarative-rest.js'

export const retableConnector = declarativeRestConnector({
  kind: 'retable',
  displayName: 'Retable',
  description: 'Turn your spreadsheets into smart database apps. Create and manage projects, workspaces, and records.',
  auth: { kind: 'api-key', hint: 'Retable API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.retable.io/v1',
  test: { method: 'GET', path: '/workspaces' },
  capabilities: [
    {
      name: 'workspaces.list',
      class: 'read',
      description: 'List all workspaces.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/workspaces' },
    },
    {
      name: 'workspaces.create',
      class: 'mutation',
      description: 'Create a new workspace.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/workspaces',
        body: { name: '{name}', description: '{description}', color: '{color}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List all projects.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/projects',
        query: { workspaceId: '{workspaceId}' },
      },
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new project.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          color: { type: 'string' },
          workspaceId: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/projects',
        body: {
          name: '{name}',
          description: '{description}',
          color: '{color}',
          workspaceId: '{workspaceId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'retables.list',
      class: 'read',
      description: 'List all retables (tables) in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/retables',
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a retable.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          retableId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['projectId', 'retableId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/retables/{retableId}/records',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Get a specific record from a retable.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          retableId: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['projectId', 'retableId', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/retables/{retableId}/records/{recordId}',
      },
    },
    {
      name: 'records.list',
      class: 'read',
      description: 'List records in a retable.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          retableId: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['projectId', 'retableId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/retables/{retableId}/records',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update a record in a retable.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          retableId: { type: 'string' },
          recordId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['projectId', 'retableId', 'recordId', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/projects/{projectId}/retables/{retableId}/records/{recordId}',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
