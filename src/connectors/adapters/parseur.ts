import { declarativeRestConnector } from './declarative-rest.js'

export const parseurConnector = declarativeRestConnector({
  kind: 'parseur',
  displayName: 'Parseur',
  description: 'Extract structured data from emails, PDFs, invoices, and forms. Create documents, process files, and retrieve parsed results.',
  auth: { kind: 'api-key', hint: 'Parseur API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.parseur.com/api/v2',
  test: { method: 'GET', path: '/documents' },
  capabilities: [
    {
      name: 'documents.find',
      class: 'read',
      description: 'Find a document by name or search criteria.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search term to filter documents by name (case insensitive).' },
          limit: { type: 'integer', description: 'Maximum number of documents to return.' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/documents', query: { search: '{search}', limit: '{limit}' } },
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Get a parsed document by its ID.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The ID of the document.' },
        },
        required: ['documentId'],
      },
      request: { method: 'GET', path: '/documents/{documentId}' },
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description: 'Create a new document for parsing from email data.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'The subject of the document/email.' },
          from: { type: 'string', description: 'The sender email address.' },
          recipient: { type: 'string', description: 'The recipient email address.' },
          to: { type: 'string', description: 'The to email address.' },
          cc: { type: 'string', description: 'The cc email address.' },
          bcc: { type: 'string', description: 'The bcc email address.' },
          body_html: { type: 'string', description: 'The HTML content of the document/email.' },
          body_plain: { type: 'string', description: 'The plain text content of the document/email.' },
          message_headers: { type: 'object', description: 'A JSON object representing the email headers (key-value pairs).' },
        },
        required: ['subject', 'from', 'recipient'],
      },
      request: {
        method: 'POST',
        path: '/documents',
        body: {
          subject: '{subject}',
          from: '{from}',
          recipient: '{recipient}',
          to: '{to}',
          cc: '{cc}',
          bcc: '{bcc}',
          body_html: '{body_html}',
          body_plain: '{body_plain}',
          message_headers: '{message_headers}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.createFromFile',
      class: 'mutation',
      description: 'Create a new document for parsing from a file upload.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'The file to upload.' },
          subject: { type: 'string', description: 'The subject of the document.' },
          from: { type: 'string', description: 'The sender email address.' },
          recipient: { type: 'string', description: 'The recipient email address.' },
        },
        required: ['file', 'subject', 'from', 'recipient'],
      },
      request: {
        method: 'POST',
        path: '/documents/file',
        body: {
          file: '{file}',
          subject: '{subject}',
          from: '{from}',
          recipient: '{recipient}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.reprocess',
      class: 'mutation',
      description: 'Reprocess a document to extract data again.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The ID of the document to reprocess.' },
        },
        required: ['documentId'],
      },
      request: { method: 'POST', path: '/documents/{documentId}/reprocess' },
      cas: 'optimistic-read-verify',
    },
  ],
})
