import { declarativeRestConnector } from './declarative-rest.js'

export const pdfmonkeyConnector = declarativeRestConnector({
  kind: 'pdfmonkey',
  displayName: 'PDFMonkey',
  description: 'Generate, find, and delete PDF documents using PDFMonkey templates.',
  auth: { kind: 'api-key', hint: 'PDFMonkey API key.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.pdfmonkey.io/api/v1',
  test: { method: 'GET', path: '/documents' },
  capabilities: [
    {
      name: 'documents.generate',
      class: 'mutation',
      description: 'Generate a new PDF document from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'PDFMonkey template ID.' },
          payload: { type: 'object', description: 'Data to use for document generation.' },
          meta: { type: 'object', description: 'Meta-data to attach to the document.' },
          fileName: { type: 'string', description: 'Custom file name for the generated document.' },
          status: { type: 'string', description: 'Document status (draft, completed, archived).' },
        },
        required: ['templateId', 'payload'],
      },
      request: {
        method: 'POST',
        path: '/documents',
        body: {
          document: {
            template_id: '{templateId}',
            payload: '{payload}',
            meta: '{meta}',
            file_name: '{fileName}',
            status: '{status}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.find',
      class: 'read',
      description: 'Retrieve a specific PDF document by ID.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string', description: 'PDFMonkey document ID.' } },
        required: ['documentId'],
      },
      request: { method: 'GET', path: '/documents/{documentId}' },
    },
    {
      name: 'documents.list',
      class: 'read',
      description: 'List all PDF documents.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum number of documents to return.' },
          offset: { type: 'integer', description: 'Number of documents to skip.' },
        },
      },
      request: { method: 'GET', path: '/documents', query: { limit: '{limit}', offset: '{offset}' } },
    },
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a PDF document.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string', description: 'PDFMonkey document ID to delete.' } },
        required: ['documentId'],
      },
      request: { method: 'DELETE', path: '/documents/{documentId}' },
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List the PDF templates available in the PDFMonkey workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum number of templates to return.' },
          offset: { type: 'integer', description: 'Number of templates to skip.' },
        },
      },
      request: {
        method: 'GET',
        path: '/document_templates',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'documents.share',
      class: 'mutation',
      description: 'Generate a public share URL for an existing PDFMonkey document.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'PDFMonkey document ID to share.' },
        },
        required: ['documentId'],
      },
      request: {
        method: 'POST',
        path: '/documents/{documentId}/share_link',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'documents.regenerate',
      class: 'mutation',
      description: 'Regenerate a previously generated PDFMonkey document, producing a new render.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'PDFMonkey document ID to regenerate.' },
        },
        required: ['documentId'],
      },
      request: {
        method: 'POST',
        path: '/documents/{documentId}/regenerate',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
