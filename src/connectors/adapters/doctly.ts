import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Doctly AI document conversion API.
 *
 * Doctly turns PDFs into markdown via an async job:
 *   1. POST /documents/ to upload — returns `{ id, status }`.
 *   2. GET  /documents/{id} polls — terminal states are `COMPLETED` / `FAILED`.
 *      A completed job exposes `output_file_url` for the markdown payload.
 *
 * Activepieces ships one curated action (`convertPdfToTextAction`) which
 * bundles the upload + polling loop. We expose the two real REST steps as
 * separate capabilities so the agent can orchestrate the poll itself (and so
 * a long-running upload doesn't hold a single tool call open for minutes).
 *
 * Notes:
 *   - The `documents.create` upload is `multipart/form-data` in Activepieces.
 *     Doctly also accepts a JSON body with a base64 `file` field (this is what
 *     their hosted dashboard SDK calls — see api.doctly.ai/redoc). We use the
 *     JSON path because the declarative REST runtime is JSON-only; multipart
 *     would need a bespoke executor and the JSON variant is the same
 *     resource.
 *   - Bearer auth is the same Doctly secret-text API key the catalog declares.
 */
export const doctlyConnector = declarativeRestConnector({
  kind: 'doctly',
  displayName: 'Doctly AI',
  description: 'Convert PDFs to markdown via the Doctly document-parse API.',
  auth: { kind: 'api-key', hint: 'Doctly API key (Bearer token).' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.doctly.ai/api/v1',
  capabilities: [
    {
      name: 'convert.pdf.to.text',
      class: 'mutation',
      description:
        'Upload a PDF document for markdown conversion. Returns a document handle with `id` and initial `status`; poll documents.get until status is COMPLETED, then fetch output_file_url.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description:
              'PDF payload as a base64-encoded string (no data: URL prefix). The Doctly API treats this as the document body.',
          },
          filename: {
            type: 'string',
            description: 'Original filename of the uploaded PDF (used for downstream document naming).',
          },
        },
        required: ['file'],
      },
      request: {
        method: 'POST',
        path: '/documents/',
        body: {
          file: '{file}',
          filename: '{filename}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'documents.get',
      class: 'read',
      description:
        'Fetch the current state of a Doctly document by id. Use this to poll the upload until status is COMPLETED or FAILED; the COMPLETED payload includes `output_file_url`.',
      parameters: {
        type: 'object',
        properties: {
          documentId: {
            type: 'string',
            description: 'Document id returned by convert.pdf.to.text.',
          },
        },
        required: ['documentId'],
      },
      request: {
        method: 'GET',
        path: '/documents/{documentId}',
      },
    },
  ],
})
