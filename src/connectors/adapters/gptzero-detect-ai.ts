import { declarativeRestConnector } from './declarative-rest.js'

export const gptzeroDetectAiConnector = declarativeRestConnector({
  kind: 'gptzero-detect-ai',
  displayName: 'GPTZero',
  description: 'Detect AI-generated text with GPTZero API.',
  auth: { kind: 'api-key', hint: 'GPTZero API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.gptzero.me',
  test: { method: 'POST', path: '/v2/predict/text', body: { document: 'test' } },
  capabilities: [
    {
      name: 'scan.text',
      class: 'mutation',
      description: 'Scan text content for AI-generated content.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      request: { method: 'POST', path: '/v2/predict/text', body: { document: '{text}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'scan.file',
      class: 'mutation',
      description: 'Scan file for AI-generated content.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string' },
        },
        required: ['file'],
      },
      request: { method: 'POST', path: '/v2/predict/file', body: { document: '{file}' } },
      cas: 'native-idempotency',
    },
  ],
})
