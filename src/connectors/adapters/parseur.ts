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
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a document / parse job by ID.',
      parameters: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The ID of the document to delete.' },
        },
        required: ['documentId'],
      },
      request: { method: 'DELETE', path: '/documents/{documentId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List parser templates configured for a given mailbox (parser).',
      parameters: {
        type: 'object',
        properties: {
          parserId: {
            type: 'string',
            description:
              'The ID of the parser (mailbox) whose templates to list. In Parseur, templates are scoped to a parser.',
          },
          limit: { type: 'integer', description: 'Maximum number of templates to return.' },
        },
        required: ['parserId'],
      },
      request: {
        method: 'GET',
        path: '/parsers/{parserId}/templates',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'templates.train',
      class: 'mutation',
      description:
        'Submit feedback to retrain a template. The body is forwarded as-is so callers can pass corrected field positions, sample text, or layout adjustments per the Parseur template-training spec.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template to train.' },
          document_id: {
            type: 'string',
            description: 'Optional ID of a document whose extraction was incorrect.',
          },
          fields: {
            type: 'array',
            description: 'Corrected field values to use as training feedback.',
          },
          sample_text: {
            type: 'string',
            description: 'Raw text that the template should match.',
          },
        },
        required: ['templateId'],
      },
      request: {
        method: 'POST',
        path: '/templates/{templateId}/train',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'mailboxes.list',
      class: 'read',
      description: 'List parser mailboxes (Parseur exposes mailboxes through its parsers endpoint).',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Search term to filter mailboxes by name.',
          },
          limit: { type: 'integer', description: 'Maximum number of mailboxes to return.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/parsers',
        query: { search: '{search}', limit: '{limit}' },
      },
    },
  ],
})
