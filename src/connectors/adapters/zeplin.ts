import { declarativeRestConnector } from './declarative-rest.js'

export const zeplinConnector = declarativeRestConnector({
  kind: 'zeplin',
  displayName: 'Zeplin',
  description:
    'Collaborate on design projects in Zeplin: find and update projects and screens, create notes on designs.',
  auth: { kind: 'api-key', hint: 'Zeplin API token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zeplin.io/v1',
  test: { method: 'GET', path: '/projects' },
  capabilities: [
    {
      name: 'projects.search',
      class: 'read',
      description: 'Find a project by name.',
      parameters: {
        type: 'object',
        properties: { projectName: { type: 'string' } },
        required: ['projectName'],
      },
      request: { method: 'GET', path: '/projects', query: { name: '{projectName}' } },
    },
    {
      name: 'projects.update',
      class: 'mutation',
      description: 'Update a project name or description.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'PUT',
        path: '/projects/{projectId}',
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'screens.search',
      class: 'read',
      description: 'Find a screen by name within a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          screenName: { type: 'string' },
        },
        required: ['projectId', 'screenName'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/screens',
        query: { name: '{screenName}' },
      },
    },
    {
      name: 'screens.update',
      class: 'mutation',
      description: 'Update a screen in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          screenId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['projectId', 'screenId'],
      },
      request: {
        method: 'PUT',
        path: '/projects/{projectId}/screens/{screenId}',
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Create a note on a design screen.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          screenId: { type: 'string' },
          content: { type: 'string' },
          color: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          xStart: { type: 'number' },
          yStart: { type: 'number' },
        },
        required: ['projectId', 'screenId', 'content', 'color', 'x', 'y'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/screens/{screenId}/notes',
        body: {
          content: '{content}',
          color: '{color}',
          x: '{x}',
          y: '{y}',
          x_start: '{xStart}',
          y_start: '{yStart}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.update',
      class: 'mutation',
      description: 'Update an existing screen note (content and/or color).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          screenId: { type: 'string' },
          noteId: { type: 'string' },
          content: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['projectId', 'screenId', 'noteId', 'content', 'color'],
      },
      request: {
        method: 'PUT',
        path: '/projects/{projectId}/screens/{screenId}/notes/{noteId}',
        body: { content: '{content}', color: '{color}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'notes.delete',
      class: 'mutation',
      description: 'Delete a screen note by id.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          screenId: { type: 'string' },
          noteId: { type: 'string' },
        },
        required: ['projectId', 'screenId', 'noteId'],
      },
      request: {
        method: 'DELETE',
        path: '/projects/{projectId}/screens/{screenId}/notes/{noteId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List all projects the authenticated user has access to.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
          status: { type: 'string', enum: ['active', 'archived', 'all'] },
        },
      },
      request: {
        method: 'GET',
        path: '/projects',
        query: { limit: '{limit}', offset: '{offset}', status: '{status}' },
      },
    },
    {
      name: 'components.list',
      class: 'read',
      description: 'List style-guide components for a given project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/styleguide/components',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
  ],
})
