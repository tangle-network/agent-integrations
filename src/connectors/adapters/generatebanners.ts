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
    {
      name: 'banner.delete',
      class: 'mutation',
      description: 'Delete a generated banner asset by ID.',
      parameters: {
        type: 'object',
        properties: {
          bannerId: { type: 'string', description: 'The ID of the rendered banner asset to delete' },
        },
        required: ['bannerId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/v1/banners/{bannerId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'template.create',
      class: 'mutation',
      description: 'Create a banner template.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template display name' },
          width: { type: 'integer', description: 'Banner width in pixels' },
          height: { type: 'integer', description: 'Banner height in pixels' },
          layers: { type: 'array', description: 'Template layers (text, image, shape, etc.)' },
        },
        required: ['name', 'width', 'height'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/templates',
        body: {
          name: '{name}',
          width: '{width}',
          height: '{height}',
          layers: '{layers}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'batch.render',
      class: 'mutation',
      description: 'Render multiple banners from a template in a single call.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'The ID of the template to render' },
          fileType: { type: 'string', enum: ['jpg', 'png', 'webp'], description: 'Output file format' },
          items: {
            type: 'array',
            description: 'Array of variable sets — one rendered output per entry',
            items: { type: 'object' },
          },
        },
        required: ['templateId', 'fileType', 'items'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/templates/{templateId}/batch-render',
        query: { fileType: '{fileType}' },
        body: { items: '{items}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
