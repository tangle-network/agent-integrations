import { declarativeRestConnector } from './declarative-rest.js'

export const tableauConnector = declarativeRestConnector({
  kind: 'tableau',
  displayName: 'Tableau',
  description: 'Business intelligence and analytics platform for data visualization.',
  auth: { kind: 'api-key', hint: 'Tableau Server or Cloud API credentials (personal access token or username/password).' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'serverUrl' },
  test: { method: 'GET', path: '/api/3.19/sites' },
  capabilities: [
    {
      name: 'views.download',
      class: 'read',
      description: 'Download a Tableau view in the specified format (image or PDF).',
      parameters: {
        type: 'object',
        properties: {
          viewId: { type: 'string', description: 'The ID of the view to download' },
          format: { type: 'string', enum: ['png', 'pdf', 'jpg'], description: 'Download format' },
          maxAge: { type: 'number', description: 'Maximum age of cached data in minutes' },
          vizWidth: { type: 'number', description: 'Width of the visualization in pixels' },
          vizHeight: { type: 'number', description: 'Height of the visualization in pixels' },
        },
        required: ['viewId', 'format'],
      },
      request: {
        method: 'GET',
        path: '/api/3.19/sites/{siteId}/views/{viewId}/image',
        query: { maxAge: '{maxAge}', vizWidth: '{vizWidth}', vizHeight: '{vizHeight}' },
      },
    },
    {
      name: 'views.find',
      class: 'read',
      description: 'Find a Tableau view by name within a workbook.',
      parameters: {
        type: 'object',
        properties: {
          viewName: { type: 'string', description: 'The URL name of the view' },
          workbookId: { type: 'string', description: 'The ID of the workbook' },
        },
        required: ['viewName', 'workbookId'],
      },
      request: {
        method: 'GET',
        path: '/api/3.19/sites/{siteId}/workbooks/{workbookId}/views',
        query: { filter: 'name:eq:{viewName}' },
      },
    },
    {
      name: 'workbooks.find',
      class: 'read',
      description: 'Find a Tableau workbook by content URL or ID.',
      parameters: {
        type: 'object',
        properties: {
          searchType: { type: 'string', enum: ['workbookId', 'contentUrl'], description: 'Search by workbook ID or content URL' },
          workbookId: { type: 'string', description: 'The ID of the workbook' },
          contentUrl: { type: 'string', description: 'The content URL of the workbook' },
        },
        required: ['searchType'],
      },
      request: {
        method: 'GET',
        path: '/api/3.19/sites/{siteId}/workbooks',
        query: { filter: 'name:eq:{contentUrl}' },
      },
    },
    {
      name: 'workbooks.refresh',
      class: 'mutation',
      description: 'Refresh all extracts in a workbook.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string', description: 'The ID of the workbook to refresh' },
        },
        required: ['workbookId'],
      },
      request: {
        method: 'POST',
        path: '/api/3.19/sites/{siteId}/workbooks/{workbookId}/refresh',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'extracts.refresh',
      class: 'mutation',
      description: 'Run an extract refresh task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The ID of the extract refresh task' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'POST',
        path: '/api/3.19/sites/{siteId}/tasks/extractRefreshes/{taskId}/runNow',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'datasources.query',
      class: 'read',
      description: 'List datasources in a site.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'The site ID (optional, uses default if not provided)' },
          limit: { type: 'number', description: 'Maximum number of results' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/3.19/sites/{siteId}/datasources',
        query: { pageSize: '{limit}' },
      },
    },
    {
      name: 'workbooks.delete',
      class: 'mutation',
      description: 'Delete a workbook by ID.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'The site ID' },
          workbookId: { type: 'string', description: 'The ID of the workbook to delete' },
        },
        required: ['siteId', 'workbookId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/3.19/sites/{siteId}/workbooks/{workbookId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.create',
      class: 'mutation',
      description: 'Create a subscription to a view or workbook.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'The site ID' },
          subscription: {
            type: 'object',
            description: 'Tableau subscription envelope, e.g. { subscription: { subject, contentId, userId, scheduleId, ... } }',
          },
        },
        required: ['siteId', 'subscription'],
      },
      request: {
        method: 'POST',
        path: '/api/3.19/sites/{siteId}/subscriptions',
        body: { subscription: '{subscription}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'datasources.delete',
      class: 'mutation',
      description: 'Delete a datasource by ID.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'The site ID' },
          datasourceId: { type: 'string', description: 'The ID of the datasource to delete' },
        },
        required: ['siteId', 'datasourceId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/3.19/sites/{siteId}/datasources/{datasourceId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
