import { declarativeRestConnector } from './declarative-rest.js'

export const wrikeConnector = declarativeRestConnector({
  kind: 'wrike',
  displayName: 'Wrike',
  description: 'Manage projects, tasks, folders, and comments in Wrike, the work management and collaboration platform.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.wrike.com/oauth2/authorize',
    tokenUrl: 'https://www.wrike.com/oauth2/token',
    scopes: ['wsReadOnly', 'wsReadWrite'],
    clientIdEnv: 'WRIKE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WRIKE_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.wrike.com/api/v4',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a new task in Wrike.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          responsible: {
            type: 'array',
            items: { type: 'string' },
          },
          dates: {
            type: 'object',
            properties: {
              start: { type: 'string' },
              due: { type: 'string' },
            },
          },
          priority: {
            type: 'string',
            enum: ['High', 'Normal', 'Low'],
          },
          customFields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['id', 'value'],
            },
          },
        },
        required: ['folderId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/folders/{folderId}/tasks',
        body: {
          title: '{title}',
          description: '{description}',
          responsible: '{responsible}',
          dates: '{dates}',
          priority: '{priority}',
          customFields: '{customFields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an existing Wrike task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          responsible: {
            type: 'array',
            items: { type: 'string' },
          },
          dates: {
            type: 'object',
            properties: {
              start: { type: 'string' },
              due: { type: 'string' },
            },
          },
          priority: {
            type: 'string',
            enum: ['High', 'Normal', 'Low'],
          },
          status: {
            type: 'string',
            enum: ['Active', 'Completed', 'OnHold', 'Cancelled'],
          },
          customFields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['id', 'value'],
            },
          },
        },
        required: ['taskId'],
      },
      request: {
        method: 'PUT',
        path: '/tasks/{taskId}',
        body: {
          title: '{title}',
          description: '{description}',
          responsible: '{responsible}',
          dates: '{dates}',
          priority: '{priority}',
          status: '{status}',
          customFields: '{customFields}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'folders.create',
      class: 'mutation',
      description: 'Create a new folder in a Wrike workspace.',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['parentId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/folders/{parentId}/folders',
        body: {
          title: '{title}',
          description: '{description}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new project in Wrike.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          accessType: {
            type: 'string',
            enum: ['Public', 'Private'],
          },
          customFields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['id', 'value'],
            },
          },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/projects',
        body: {
          title: '{title}',
          description: '{description}',
          accessType: '{accessType}',
          customFields: '{customFields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.add',
      class: 'mutation',
      description: 'Add a comment to a task in Wrike.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          text: { type: 'string' },
          attachments: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['taskId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{taskId}/comments',
        body: {
          text: '{text}',
          attachments: '{attachments}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'attachments.upload',
      class: 'mutation',
      description: 'Upload an attachment to a task in Wrike.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          filename: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['taskId', 'filename', 'url'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{taskId}/attachments',
        body: {
          filename: '{filename}',
          url: '{url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.find',
      class: 'read',
      description: 'Search for a task in Wrike by title or ID.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          status: {
            type: 'string',
            enum: ['Active', 'Completed', 'OnHold', 'Cancelled'],
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/tasks',
        query: {
          id: '{taskId}',
          title: '{title}',
          status: '{status}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'folders.find',
      class: 'read',
      description: 'Search for a folder in Wrike.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          title: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/folders',
        query: {
          id: '{folderId}',
          title: '{title}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
  ],
})
