import { declarativeRestConnector } from './declarative-rest.js'

export const documergeConnector = declarativeRestConnector({
  kind: 'documerge',
  displayName: 'DocuMerge',
  description:
    'Merge and generate documents with dynamic data via DocuMerge: combine files, convert files to PDF, split PDFs, and run document/data-route merges.',
  auth: { kind: 'api-key', hint: 'DocuMerge API key issued from the workspace settings.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.documerge.ai/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'files.combine',
      class: 'mutation',
      description:
        'Combine multiple files (by file identifier, URL, or inline contents) into a single output file in the requested format.',
      parameters: {
        type: 'object',
        properties: {
          output: {
            type: 'string',
            description: 'Output format for the combined file (e.g. "pdf", "docx").',
          },
          files: {
            type: 'array',
            description: 'Array of file identifiers to combine.',
            items: { type: 'string' },
          },
          name: { type: 'string', description: 'Name for the combined output file.' },
          url: {
            type: 'string',
            format: 'uri',
            description: 'URL of an additional file to include in the merge.',
          },
          contents: {
            type: 'string',
            description: 'Additional inline content to include alongside the listed files.',
          },
        },
        required: ['output', 'files'],
      },
      request: {
        method: 'POST',
        path: '/files/combine',
        body: {
          output: '{output}',
          files: '{files}',
          name: '{name}',
          url: '{url}',
          contents: '{contents}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'files.convertToPdf',
      class: 'mutation',
      description: 'Convert a single file (by file identifier or remote URL) into a PDF.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'Name of the file to convert.' },
          fileUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL of the source file to convert (if the file is not already uploaded).',
          },
        },
        required: ['fileName'],
      },
      request: {
        method: 'POST',
        path: '/files/convert-to-pdf',
        body: {
          fileName: '{fileName}',
          fileUrl: '{fileUrl}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'dataRouteMerge.create',
      class: 'mutation',
      description: 'Run a data-route merge using a configured route key and a field-data payload.',
      parameters: {
        type: 'object',
        properties: {
          routeKey: { type: 'string', description: 'Key of the data route to merge against.' },
          fields: {
            type: 'object',
            description: 'Field data to merge into the route template.',
          },
        },
        required: ['routeKey'],
      },
      request: {
        method: 'POST',
        path: '/data-routes/merge',
        body: {
          routeKey: '{routeKey}',
          fields: '{fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documentMerge.create',
      class: 'mutation',
      description: 'Run a document merge using a configured document key and a field-data payload.',
      parameters: {
        type: 'object',
        properties: {
          documentKey: { type: 'string', description: 'Key of the document template to merge.' },
          fields: {
            type: 'object',
            description: 'Field data to merge into the document template.',
          },
        },
        required: ['documentKey'],
      },
      request: {
        method: 'POST',
        path: '/documents/merge',
        body: {
          documentKey: '{documentKey}',
          fields: '{fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pdf.split',
      class: 'mutation',
      description:
        'Split a PDF by extracting and/or removing specified page numbers or ranges; returns the resulting PDF(s).',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: 'Name of the source PDF file.' },
          fileUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL of the source PDF if not already uploaded.',
          },
          extract: {
            type: 'array',
            description: 'Page numbers or ranges to extract (e.g. ["1", "3-5"]).',
            items: { type: 'string' },
          },
          remove: {
            type: 'array',
            description: 'Page numbers or ranges to remove (e.g. ["2", "6-7"]).',
            items: { type: 'string' },
          },
        },
        required: ['fileName'],
      },
      request: {
        method: 'POST',
        path: '/pdf/split',
        body: {
          fileName: '{fileName}',
          fileUrl: '{fileUrl}',
          extract: '{extract}',
          remove: '{remove}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
