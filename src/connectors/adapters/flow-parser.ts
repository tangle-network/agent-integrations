import { declarativeRestConnector } from './declarative-rest.js'

export const flowParserConnector = declarativeRestConnector({
  kind: 'flow-parser',
  displayName: 'FlowParser',
  description: 'Upload, process, and manage documents programmatically with FlowParser.',
  auth: { kind: 'api-key', hint: 'FlowParser API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.flowparser.ai/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'documents.upload',
      class: 'mutation',
      description: 'Upload a document for processing.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          mimeType: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['filename', 'content'],
      },
      request: {
        method: 'POST',
        path: '/documents/upload',
        body: {
          filename: '{filename}',
          mimeType: '{mimeType}',
          content: '{content}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Retrieve a parsed document by ID.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId'],
      },
      request: { method: 'GET', path: '/documents/{documentId}' },
    },
    {
      name: 'documents.list',
      class: 'read',
      description: 'List all documents.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/documents',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a document.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId'],
      },
      request: { method: 'DELETE', path: '/documents/{documentId}' },
    },
    {
      name: 'flows.run',
      class: 'mutation',
      description:
        'Trigger a FlowParser parsing flow against an uploaded document, returning the async run handle. Each invocation is billed and side-effecting; FlowParser dedupes on (flowId, documentId, idempotencyKey).',
      parameters: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'FlowParser flow id to execute.' },
          documentId: {
            type: 'string',
            description: 'Document id (from documents.upload) the flow should parse.',
          },
        },
        required: ['flowId', 'documentId'],
      },
      request: {
        method: 'POST',
        path: '/flows/{flowId}/run',
        body: {
          documentId: '{documentId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
