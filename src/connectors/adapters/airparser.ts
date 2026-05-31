import { declarativeRestConnector } from './declarative-rest.js'

export const airparserConnector = declarativeRestConnector({
  kind: 'airparser',
  displayName: 'Airparser',
  description: 'Extract structured data from emails, PDFs, or documents with Airparser.',
  auth: { kind: 'api-key', hint: 'Airparser API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.airparser.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'documents.upload',
      class: 'mutation',
      description: 'Upload a document for parsing.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Document file content or URL.' },
          fileName: { type: 'string', description: 'Name of the document file.' },
          meta: { type: 'object', description: 'Optional metadata to associate with the document.' },
        },
        required: ['file'],
      },
      request: {
        method: 'POST',
        path: '/documents/upload',
        body: { file: '{file}', fileName: '{fileName}', meta: '{meta}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.extract',
      class: 'read',
      description: 'Extract structured data from a document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the uploaded document.' },
          markdown: { type: 'string', description: 'Template or schema for extraction in markdown format.' },
        },
        required: ['documentId', 'markdown'],
      },
      request: {
        method: 'POST',
        path: '/documents/{documentId}/extract',
        body: { markdown: '{markdown}' },
      },
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Retrieve document parsing status and results.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'ID of the document to retrieve.' },
        },
        required: ['documentId'],
      },
      request: { method: 'GET', path: '/documents/{documentId}' },
    },
  ],
})
