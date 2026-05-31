import { declarativeRestConnector } from './declarative-rest.js'

export const robollyConnector = declarativeRestConnector({
  kind: 'robolly',
  displayName: 'Robolly',
  description: 'Generate personalized images, videos, and PDFs using Robolly templates.',
  auth: { kind: 'api-key', hint: 'Robolly API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.robolly.com/v1',
  test: { method: 'GET', path: '/templates' },
  capabilities: [
    {
      name: 'images.generate',
      class: 'mutation',
      description: 'Generate a personalized image from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The template ID to generate from.' },
          format: { type: 'string', description: 'The output format (e.g., png, jpg, webp).' },
          fields: { type: 'object', description: 'Template field values to personalize the image.' },
          modifications: { type: 'object', description: 'Additional modifications to apply.' },
        },
        required: ['templateId', 'format'],
      },
      request: {
        method: 'POST',
        path: '/render/image',
        body: {
          templateId: '{templateId}',
          format: '{format}',
          fields: '{fields}',
          modifications: '{modifications}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
