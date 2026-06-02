import { declarativeRestConnector } from './declarative-rest.js'

export const browseAiConnector = declarativeRestConnector({
  kind: 'browse-ai',
  displayName: 'Browse AI',
  description: 'Run Browse AI robots, list available robots, and fetch task details from the Browse AI cloud.',
  auth: { kind: 'api-key', hint: 'Browse AI personal API key (Bearer token from the Integrations page).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.browse.ai/v2',
  test: { method: 'GET', path: '/robots' },
  capabilities: [
    {
      name: 'get.task.details',
      class: 'read',
      description: 'Fetch the result and status for a previously queued Browse AI robot task.',
      parameters: {
        type: 'object',
        properties: {
          robotId: { type: 'string', description: 'Identifier of the robot that owns the task.' },
          taskId: { type: 'string', description: 'Identifier of the task to retrieve.' },
        },
        required: ['robotId', 'taskId'],
      },
      request: {
        method: 'GET',
        path: '/robots/{robotId}/tasks/{taskId}',
      },
    },
    {
      name: 'list.robots',
      class: 'read',
      description: 'List robots available to the authenticated Browse AI account.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page number for pagination (1-based).' },
          pageSize: { type: 'integer', description: 'Number of robots per page.' },
        },
      },
      request: {
        method: 'GET',
        path: '/robots',
        query: { page: '{page}', pageSize: '{pageSize}' },
      },
    },
    {
      name: 'run.robot',
      class: 'mutation',
      description: 'Queue a Browse AI robot task with the supplied input parameters.',
      parameters: {
        type: 'object',
        properties: {
          robotId: { type: 'string', description: 'Identifier of the robot to run.' },
          inputParameters: {
            type: 'object',
            description: 'Input parameter map passed to the robot (origin URL plus robot-specific fields).',
          },
          recordVideo: {
            type: 'boolean',
            description: 'Record a video of the task while it runs.',
          },
        },
        required: ['robotId', 'inputParameters'],
      },
      request: {
        method: 'POST',
        path: '/robots/{robotId}/tasks',
        body: {
          inputParameters: '{inputParameters}',
          recordVideo: '{recordVideo}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'capturedLists.get',
      class: 'read',
      description: 'Fetch the captured list (scraped data rows) produced by a Browse AI robot task run.',
      parameters: {
        type: 'object',
        properties: {
          robotId: { type: 'string', description: 'Identifier of the robot that produced the captured list.' },
          taskId: { type: 'string', description: 'Identifier of the task that produced the captured list.' },
          capturedListId: { type: 'string', description: 'Identifier of the captured list on the task.' },
          pageSize: { type: 'integer', description: 'Number of rows per page.' },
          pageNumber: { type: 'integer', description: 'Page number for pagination (1-based).' },
        },
        required: ['robotId', 'taskId', 'capturedListId'],
      },
      request: {
        method: 'GET',
        path: '/robots/{robotId}/tasks/{taskId}/captured-lists/{capturedListId}',
        query: { pageSize: '{pageSize}', pageNumber: '{pageNumber}' },
      },
    },
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List robot tasks belonging to the authenticated Browse AI account, optionally filtered by status or date range.',
      parameters: {
        type: 'object',
        properties: {
          robotId: { type: 'string', description: 'Identifier of the robot whose tasks to list.' },
          sort: { type: 'string', description: 'Sort order for the returned tasks (e.g. "createdAt", "-createdAt").' },
          fromDate: { type: 'string', description: 'Lower bound for task creation time (ISO 8601 or epoch ms, per Browse AI contract).' },
          toDate: { type: 'string', description: 'Upper bound for task creation time (ISO 8601 or epoch ms, per Browse AI contract).' },
          status: { type: 'string', description: 'Filter tasks by status (e.g. "successful", "failed", "in-progress").' },
        },
        required: ['robotId'],
      },
      request: {
        method: 'GET',
        path: '/robots/{robotId}/tasks',
        query: {
          sort: '{sort}',
          fromDate: '{fromDate}',
          toDate: '{toDate}',
          status: '{status}',
        },
      },
    },
  ],
})
