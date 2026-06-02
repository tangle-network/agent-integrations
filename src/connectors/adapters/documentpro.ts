import { declarativeRestConnector } from './declarative-rest.js'

/**
 * DocumentPro connector.
 *
 * DocumentPro is an AI-powered document-processing service that extracts
 * structured fields from uploaded PDFs / images using either templated
 * Workflows or a general OCR + LLM pipeline. The customer first uploads
 * a file (multipart POST /v1/documents), then runs an extract Workflow
 * against the document_id returned by upload
 * (GET /v1/documents/{id}/run_parser?template_id=...).
 *
 * Auth is a per-tenant API key delivered as the `x-api-key` header — no
 * OAuth surface exists. The key is sent on every call.
 *
 * Why only `run.extract` is modeled here:
 *   The activepieces piece exposes two actions, `uploaddocument` and
 *   `run.extract`. Upload is multipart/form-data; the declarative-REST
 *   adapter only serializes JSON bodies, so wiring upload through this
 *   adapter would silently corrupt the request. Upload belongs in a
 *   bespoke adapter (binary body + Blob) rather than a fake JSON shim.
 *   `run.extract` is a clean GET with query parameters and maps directly.
 *
 * Consistency: extraction is non-deterministic (LLM-backed), each call
 * is metered, and there is no idempotency key on the upstream — so CAS
 * posture is `none` and `externalEffect: true` to keep the orchestrator
 * out of accidental dry-run replays. The connector advertises an
 * `advisory` default consistency model: a previous extract's output is
 * cacheable for read-after-write within a session, but the upstream is
 * not the authoritative store of the parsed value (the Workflow owner is).
 */
export const documentproConnector = declarativeRestConnector({
  kind: 'documentpro',
  displayName: 'DocumentPro',
  description:
    'Run a DocumentPro extract Workflow against a previously uploaded document and receive the structured fields parsed by the AI pipeline.',
  auth: {
    kind: 'api-key',
    hint: 'DocumentPro API key (workspace settings -> API). Sent as the x-api-key header on every request.',
  },
  category: 'doc',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.documentpro.ai/v1',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: {
    accept: 'application/json',
  },
  capabilities: [
    {
      name: 'run.extract',
      class: 'mutation',
      description:
        'Run an extract / Workflow against a previously uploaded document and return the structured fields produced by the configured template. Optional flags toggle OCR, layout / table detection, page selection, and regex-based segmentation.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description:
              'ID returned by the upload endpoint (POST /v1/documents). Identifies the file to parse.',
          },
          template_id: {
            type: 'string',
            description:
              'ID of the Workflow / template to run. Templates are created in the DocumentPro UI and define the fields to extract.',
          },
          use_ocr: {
            type: 'boolean',
            description:
              'Enable the OCR pipeline. Required when using gpt-3.5-turbo or any OCR-dependent flag (layout, tables, regex segmentation).',
          },
          query_model: {
            type: 'string',
            description:
              'AI model used for parsing (e.g. "gpt-4o", "gpt-3.5-turbo"). Defaults to the template setting if omitted.',
          },
          detect_layout: {
            type: 'boolean',
            description:
              'Detect document layout (columns, headers, blocks). Requires use_ocr=true.',
          },
          detect_tables: {
            type: 'boolean',
            description:
              'Detect tables and emit them as structured rows. Requires use_ocr=true.',
          },
          page_ranges: {
            type: 'string',
            description:
              'Which pages to parse, e.g. "1-3,5,7-9". Empty / omitted = all pages.',
          },
          chunk_by_pages: {
            type: 'integer',
            description:
              'Pages per segment for method-1 segmentation. Pass 0 / omit to disable.',
          },
          rolling_window: {
            type: 'integer',
            description:
              'Window size in pages for method-2 segmentation. Pass 0 / omit to disable.',
          },
          start_regex: {
            type: 'string',
            description:
              'Regex marking where parsing should begin within the document text. Requires use_ocr=true.',
          },
          end_regex: {
            type: 'string',
            description:
              'Regex marking where parsing should stop. Requires use_ocr=true.',
          },
          split_regex: {
            type: 'string',
            description:
              'Regex used to split the document into sections before extraction. Requires use_ocr=true.',
          },
          use_all_matches: {
            type: 'boolean',
            description:
              'When true, every regex match yields a section; when false, only the first match is used. Requires use_ocr=true.',
          },
        },
        required: ['document_id', 'template_id'],
      },
      request: {
        method: 'GET',
        path: '/documents/{document_id}/run_parser',
        query: {
          template_id: '{template_id}',
          use_ocr: '{use_ocr}',
          query_model: '{query_model}',
          detect_layout: '{detect_layout}',
          detect_tables: '{detect_tables}',
          page_ranges: '{page_ranges}',
          chunk_by_pages: '{chunk_by_pages}',
          rolling_window: '{rolling_window}',
          start_regex: '{start_regex}',
          end_regex: '{end_regex}',
          split_regex: '{split_regex}',
          use_all_matches: '{use_all_matches}',
        },
      },
      // LLM-backed extraction with billing-class effects; the upstream
      // does not honour a client-supplied idempotency key, so the caller
      // owns dedupe.
      cas: 'none',
      externalEffect: true,
    },
    {
      // Hard-delete of a document and its derived extractions. DocumentPro
      // billing meters extraction, not retention, so removing the source
      // file does not refund prior `run.extract` calls.
      name: 'documents.delete',
      class: 'mutation',
      description:
        'Delete a previously uploaded DocumentPro document and its associated extraction history. Cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'ID of the document to remove (returned by the upload endpoint).',
          },
        },
        required: ['document_id'],
      },
      request: {
        method: 'DELETE',
        path: '/documents/{document_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      // Export the structured extraction output for downstream pipelines.
      // Modeled as a mutation because the upstream meters export calls and
      // some formats (xlsx, csv) re-run formatting pipelines server-side.
      name: 'extraction.export',
      class: 'mutation',
      description:
        'Export the structured extraction for a document in the requested format (json, csv, xlsx). The response is the serialized export payload.',
      parameters: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'ID of the document whose extraction should be exported.',
          },
          template_id: {
            type: 'string',
            description: 'Template / Workflow whose extraction is being exported. Required when a document has multiple templates run against it.',
          },
          format: {
            type: 'string',
            enum: ['json', 'csv', 'xlsx'],
            description: 'Export format. Defaults to json on the upstream when omitted.',
          },
        },
        required: ['document_id'],
      },
      request: {
        method: 'GET',
        path: '/documents/{document_id}/export',
        query: {
          template_id: '{template_id}',
          format: '{format}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
