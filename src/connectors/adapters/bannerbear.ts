import { declarativeRestConnector } from './declarative-rest.js'

export const bannerbearConnector = declarativeRestConnector({
  kind: 'bannerbear',
  displayName: 'Bannerbear',
  description: 'Automate image generation using Bannerbear templates.',
  auth: {
    kind: 'api-key',
    hint: 'Bannerbear API key.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bannerbear.com/v2',
  test: { method: 'GET', path: '/templates' },
  capabilities: [
    {
      name: 'images.create',
      class: 'mutation',
      description: 'Create an image using a Bannerbear template with specified modifications.',
      parameters: {
        type: 'object',
        properties: {
          templateId: {
            type: 'string',
            description: 'The ID of the template to use for image creation.',
          },
          modifications: {
            type: 'object',
            description: 'A list of modifications to apply to the template layers.',
          },
          templateVersion: {
            type: 'integer',
            description: 'Create image based on a specific version of the template.',
          },
          transparent: {
            type: 'boolean',
            description: 'Render a PNG with a transparent background. Default is false.',
          },
          renderPdf: {
            type: 'boolean',
            description: 'Render a PDF instead of a PNG. Default is false.',
          },
          metadata: {
            type: 'string',
            description: 'Any metadata you need to store, e.g., ID of a record in your DB.',
          },
        },
        required: ['templateId', 'modifications'],
      },
      request: {
        method: 'POST',
        path: '/images',
        body: {
          template_id: '{templateId}',
          modifications: '{modifications}',
          template_version: '{templateVersion}',
          transparent: '{transparent}',
          render_pdf: '{renderPdf}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
