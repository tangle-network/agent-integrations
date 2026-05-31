import { declarativeRestConnector } from './declarative-rest.js'

export const generatebannersConnector = declarativeRestConnector({
  kind: 'generatebanners',
  displayName: 'GenerateBanners',
  description: 'Generate custom banners and social media images from templates.',
  auth: { kind: 'api-key', hint: 'GenerateBanners API key.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.generatebanners.com',
  test: { method: 'GET', path: '/api/v1/status' },
  capabilities: [
    {
      name: 'templates.render',
      class: 'mutation',
      description: 'Render a template to generate a banner or social media image.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template to render' },
          fileType: { type: 'string', enum: ['jpg', 'png', 'webp'], description: 'Output file format' },
          variables: { type: 'object', description: 'Template variables as key-value pairs' },
        },
        required: ['templateId', 'fileType'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/templates/{templateId}/render',
        query: { fileType: '{fileType}' },
        body: { variables: '{variables}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
