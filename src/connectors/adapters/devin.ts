import { declarativeRestConnector } from './declarative-rest.js'

export const devinConnector = declarativeRestConnector({
  kind: 'devin',
  displayName: 'Devin',
  description: 'Create Devin sessions, fetch session details, and post messages to a running session.',
  auth: { kind: 'api-key', hint: 'Devin API key sent as Authorization: Bearer <token>.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.devin.ai/v1',
  test: { method: 'GET', path: '/sessions' },
  capabilities: [
    {
      name: 'create.session',
      class: 'mutation',
      description: 'Create a new Devin session with an initial prompt.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          snapshotId: { type: 'string' },
          playbookId: { type: 'string' },
          unlisted: { type: 'boolean' },
          idempotent: { type: 'boolean' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/sessions',
        body: {
          prompt: '{prompt}',
          snapshot_id: '{snapshotId}',
          playbook_id: '{playbookId}',
          unlisted: '{unlisted}',
          idempotent: '{idempotent}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.session.details',
      class: 'read',
      description: 'Retrieve details for an existing Devin session.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
      request: { method: 'GET', path: '/session/{sessionId}' },
    },
    {
      name: 'send.message',
      class: 'mutation',
      description: 'Send a follow-up message to an active Devin session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['sessionId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/session/{sessionId}/message',
        body: { message: '{message}' },
      },
    },
  ],
})
