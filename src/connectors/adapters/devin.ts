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
    {
      name: 'sessions.list',
      class: 'read',
      description: 'List Devin sessions visible to the API key. Optional limit/status filters.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of sessions to return.' },
          status: { type: 'string', description: 'Filter to sessions in the given status.' },
        },
      },
      request: {
        method: 'GET',
        path: '/sessions',
        query: { limit: '{limit}', status: '{status}' },
      },
    },
    {
      name: 'attachments.upload',
      class: 'mutation',
      description:
        'Upload an attachment to an existing Devin session. `content` is the file body; set `encoding="base64"` for binary payloads. `mime_type` defaults upstream when omitted.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Devin session id the attachment belongs to.' },
          content: { type: 'string', description: 'File contents, interpreted per `encoding`.' },
          encoding: {
            type: 'string',
            enum: ['utf-8', 'base64'],
            default: 'utf-8',
            description: 'Encoding of `content`. Use base64 for binary payloads.',
          },
          filename: { type: 'string', description: 'Filename including extension.' },
          mime_type: { type: 'string', description: 'Optional MIME type for the upload.' },
        },
        required: ['session_id', 'content', 'filename'],
      },
      request: {
        method: 'POST',
        path: '/attachments',
        body: {
          session_id: '{session_id}',
          content: '{content}',
          filename: '{filename}',
          encoding: '{encoding}',
          mime_type: '{mime_type}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
