import { declarativeRestConnector } from './declarative-rest.js'

// AWS Textract is exposed via the JSON 1.1 query protocol: a single POST to /
// with the X-Amz-Target header naming the operation
// (Textract.AnalyzeDocument, Textract.DetectDocumentText, etc.). Each request is
// signed with AWS Signature V4 (`credentialPlacement: aws-sigv4`) from the
// credential bundle in the api-key field; the bundle's region is substituted
// into the `{region}` host template, and metadataKey 'endpoint' still allows a
// per-tenant host override (textract.<region>.amazonaws.com).
//
// The catalog enumerates 5 actions (AnalyzeDocument, DetectDocumentText,
// AnalyzeExpense, AnalyzeId, AnalyzeDocumentAsync). The async path returns a
// JobId; results are retrieved via GetDocumentAnalysis, which we expose as a
// read capability so callers can poll/page large multi-page documents.
//
// Generative inference is non-idempotent in the strict sense, but Textract's
// extractive (OCR/form/table/signature) outputs are deterministic for a given
// document — we model the synchronous Analyze*/Detect* calls as authoritative
// reads against the document, and the async-start call as the sole mutation
// (it allocates a server-side job id).

export const amazonTextractConnector = declarativeRestConnector({
  kind: 'amazon-textract',
  displayName: 'AWS Textract',
  description:
    'Extract text, forms, tables, signatures, and structured data (expense, identity) from documents using AWS Textract.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}. Optional "sessionToken" and "endpoint". Requests are signed with AWS Signature V4; the region selects the textract.<region>.amazonaws.com endpoint.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  credentialPlacement: { kind: 'aws-sigv4', service: 'textract' },
  baseUrl: {
    metadataKey: 'endpoint',
    fallback: 'https://textract.{region}.amazonaws.com',
  },
  defaultHeaders: {
    'Content-Type': 'application/x-amz-json-1.1',
  },
  test: {
    method: 'POST',
    path: '/',
    headers: { 'X-Amz-Target': 'Textract.DetectDocumentText' },
    // Empty Document — the call will return InvalidParameterException; the
    // 4xx response still proves auth + endpoint reachability without
    // mutating anything or charging for a real OCR job.
    body: { Document: {} },
  },
  capabilities: [
    {
      name: 'document.analyze',
      class: 'read',
      description:
        'Analyze a document for forms, tables, signatures, layout, and queries (synchronous). Single-page JPEG/PNG up to 5 MB direct upload, or any size when sourced from S3.',
      parameters: {
        type: 'object',
        properties: {
          Document: {
            type: 'object',
            description:
              'Document source. Either { Bytes: base64-encoded-image } for direct upload, or { S3Object: { Bucket, Name, Version? } } for an S3-hosted document.',
          },
          FeatureTypes: {
            type: 'array',
            description:
              'List of features to extract. Allowed values: TABLES, FORMS, SIGNATURES, LAYOUT, QUERIES.',
          },
          QueriesConfig: {
            type: 'object',
            description:
              'Optional plain-English questions to ask about the document. Shape: { Queries: [{ Text, Alias?, Pages? }] }. Requires FeatureTypes includes QUERIES.',
          },
          HumanLoopConfig: {
            type: 'object',
            description: 'Optional Augmented AI (A2I) human review loop configuration.',
          },
          AdaptersConfig: {
            type: 'object',
            description: 'Optional custom adapter configuration for fine-tuned extraction.',
          },
        },
        required: ['Document', 'FeatureTypes'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.AnalyzeDocument' },
        body: {
          Document: '{Document}',
          FeatureTypes: '{FeatureTypes}',
          QueriesConfig: '{QueriesConfig}',
          HumanLoopConfig: '{HumanLoopConfig}',
          AdaptersConfig: '{AdaptersConfig}',
        },
      },
    },
    {
      name: 'document.text.detect',
      class: 'read',
      description:
        'Detect lines and words of text in a document (synchronous OCR). Single-page JPEG/PNG up to 5 MB direct upload, or any size when sourced from S3.',
      parameters: {
        type: 'object',
        properties: {
          Document: {
            type: 'object',
            description:
              'Document source. Either { Bytes: base64-encoded-image } or { S3Object: { Bucket, Name, Version? } }.',
          },
        },
        required: ['Document'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.DetectDocumentText' },
        body: { Document: '{Document}' },
      },
    },
    {
      name: 'expense.analyze',
      class: 'read',
      description:
        'Extract receipt/invoice fields (vendor, total, line items, tax) from an expense document (synchronous).',
      parameters: {
        type: 'object',
        properties: {
          Document: {
            type: 'object',
            description:
              'Document source. Either { Bytes: base64-encoded-image } or { S3Object: { Bucket, Name, Version? } }.',
          },
        },
        required: ['Document'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.AnalyzeExpense' },
        body: { Document: '{Document}' },
      },
    },
    {
      name: 'id.analyze',
      class: 'read',
      description:
        'Extract structured fields (name, date of birth, document number, address) from identity documents such as drivers licenses and passports.',
      parameters: {
        type: 'object',
        properties: {
          DocumentPages: {
            type: 'array',
            description:
              'Array of 1–2 document pages, each of the form { Bytes } or { S3Object: { Bucket, Name, Version? } }.',
          },
        },
        required: ['DocumentPages'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.AnalyzeID' },
        body: { DocumentPages: '{DocumentPages}' },
      },
    },
    {
      name: 'document.analyze.async.start',
      class: 'mutation',
      description:
        'Start an asynchronous document analysis job for large or multi-page documents (PDF, TIFF). Returns a JobId for use with document.analyze.async.get.',
      parameters: {
        type: 'object',
        properties: {
          DocumentLocation: {
            type: 'object',
            description: 'S3 source: { S3Object: { Bucket, Name, Version? } }.',
          },
          FeatureTypes: {
            type: 'array',
            description:
              'List of features to extract. Allowed values: TABLES, FORMS, SIGNATURES, LAYOUT, QUERIES.',
          },
          ClientRequestToken: {
            type: 'string',
            description:
              'Idempotency token (1–64 chars). Repeated calls with the same token return the same JobId for up to 24 hours.',
          },
          JobTag: {
            type: 'string',
            description: 'Optional identifier echoed in completion notifications.',
          },
          NotificationChannel: {
            type: 'object',
            description: 'Optional SNS topic config: { SNSTopicArn, RoleArn }.',
          },
          OutputConfig: {
            type: 'object',
            description: 'Optional S3 destination for raw analysis output: { S3Bucket, S3Prefix? }.',
          },
          KMSKeyId: {
            type: 'string',
            description: 'Optional KMS key id for server-side encryption of output.',
          },
          QueriesConfig: {
            type: 'object',
            description: 'Optional queries config (same shape as the synchronous Analyze call).',
          },
          AdaptersConfig: {
            type: 'object',
            description: 'Optional custom adapter configuration.',
          },
        },
        required: ['DocumentLocation', 'FeatureTypes'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.StartDocumentAnalysis' },
        body: {
          DocumentLocation: '{DocumentLocation}',
          FeatureTypes: '{FeatureTypes}',
          ClientRequestToken: '{ClientRequestToken}',
          JobTag: '{JobTag}',
          NotificationChannel: '{NotificationChannel}',
          OutputConfig: '{OutputConfig}',
          KMSKeyId: '{KMSKeyId}',
          QueriesConfig: '{QueriesConfig}',
          AdaptersConfig: '{AdaptersConfig}',
        },
      },
      // Textract honours ClientRequestToken for 24 hours: a repeated call
      // with the same token returns the existing JobId rather than starting
      // a new job.
      cas: 'native-idempotency',
    },
    {
      name: 'document.analyze.async.get',
      class: 'read',
      description:
        'Retrieve the results of an asynchronous document analysis job started with document.analyze.async.start. Pages results via NextToken for large outputs.',
      parameters: {
        type: 'object',
        properties: {
          JobId: {
            type: 'string',
            description: 'JobId returned by document.analyze.async.start.',
          },
          MaxResults: {
            type: 'number',
            description: 'Maximum blocks per page (1–1000). Default 1000.',
          },
          NextToken: {
            type: 'string',
            description: 'Pagination cursor returned by the previous call.',
          },
        },
        required: ['JobId'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'Textract.GetDocumentAnalysis' },
        body: {
          JobId: '{JobId}',
          MaxResults: '{MaxResults}',
          NextToken: '{NextToken}',
        },
      },
    },
  ],
})
