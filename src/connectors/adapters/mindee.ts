import { declarativeRestConnector } from './declarative-rest.js'

export const mindeeConnector = declarativeRestConnector({
  kind: 'mindee',
  displayName: 'Mindee',
  description: 'Run Mindee document-AI predictions against off-the-shelf or custom APIs.',
  auth: { kind: 'api-key', hint: 'Mindee API key from https://platform.mindee.com/api-keys.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.mindee.net/v1',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Token ' },
  test: { method: 'GET', path: '/products' },
  capabilities: [
    {
      name: 'mindee.predict.document',
      class: 'mutation',
      description:
        'Submit a document URL to a Mindee prediction API and receive the parsed document object.',
      parameters: {
        type: 'object',
        properties: {
          account_name: {
            type: 'string',
            description: 'Mindee account or organization name that owns the API.',
          },
          api_name: {
            type: 'string',
            description: 'Mindee API product slug (for example invoices, receipts, passport).',
          },
          api_version: {
            type: 'string',
            description: 'API version to invoke. Defaults to v1.',
          },
          file: {
            type: 'string',
            description:
              'Remote URL of the file to parse. Supported formats: .pdf, .jpg, .png, .webp, .tiff, .heic.',
          },
        },
        required: ['account_name', 'api_name', 'file'],
      },
      request: {
        method: 'POST',
        path: '/products/{account_name}/{api_name}/v1/predict',
        body: { document: '{file}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
