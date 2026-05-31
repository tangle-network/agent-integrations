import { declarativeRestConnector } from './declarative-rest.js'

export const knockConnector = declarativeRestConnector({
  kind: 'knock',
  displayName: 'Knock',
  description: 'Notification infrastructure. Manage users, trigger workflows, and track messages.',
  auth: { kind: 'api-key', hint: 'Knock API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.knock.app/v1',
  test: { method: 'GET', path: '/users' },
  capabilities: [
    {
      name: 'workflows.trigger',
      class: 'mutation',
      description: 'Trigger a workflow for one or more recipients.',
      parameters: {
        type: 'object',
        properties: {
          workflowKey: { type: 'string', description: 'The workflow key to trigger' },
          recipients: { type: 'object', description: 'Recipient user IDs' },
          actorId: { type: 'string', description: 'Optional actor user ID' },
          data: { type: 'object', description: 'Optional key-value data for the workflow' },
        },
        required: ['workflowKey', 'recipients'],
      },
      request: {
        method: 'POST',
        path: '/workflows/{workflowKey}/trigger',
        body: { recipients: '{recipients}', actor_id: '{actorId}', data: '{data}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.identify',
      class: 'mutation',
      description: 'Identify or create a user with profile properties.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Unique user identifier' },
          name: { type: 'string', description: 'User display name' },
          email: { type: 'string', description: 'User email address' },
          phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
          avatar: { type: 'string', description: 'URL to user avatar image' },
          customProperties: { type: 'object', description: 'Additional key-value properties' },
        },
        required: ['userId'],
      },
      request: {
        method: 'PUT',
        path: '/users/{userId}',
        body: {
          name: '{name}',
          email: '{email}',
          phone_number: '{phoneNumber}',
          avatar: '{avatar}',
          custom_properties: '{customProperties}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Get a user by ID.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string', description: 'User ID' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/users/{userId}' },
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete a user by ID.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string', description: 'User ID to delete' } },
        required: ['userId'],
      },
      request: { method: 'DELETE', path: '/users/{userId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.get',
      class: 'read',
      description: 'Get a single message by ID.',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string', description: 'Message ID' } },
        required: ['messageId'],
      },
      request: { method: 'GET', path: '/messages/{messageId}' },
    },
    {
      name: 'messages.list',
      class: 'read',
      description: 'List messages with optional filtering.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Filter by channel ID' },
          status: { type: 'string', description: 'Filter by delivery status' },
          workflowKey: { type: 'string', description: 'Filter by workflow key' },
          tenant: { type: 'string', description: 'Filter by tenant' },
          pageSize: { type: 'integer', description: 'Number per page (1-50, default 50)' },
          after: { type: 'string', description: 'Pagination cursor' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/messages',
        query: {
          channel_id: '{channelId}',
          status: '{status}',
          workflow_key: '{workflowKey}',
          tenant: '{tenant}',
          page_size: '{pageSize}',
          after: '{after}',
        },
      },
    },
  ],
})
