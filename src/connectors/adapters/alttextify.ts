import { declarativeRestConnector } from './declarative-rest.js'

export const alttextifyConnector = declarativeRestConnector({
  kind: 'alttextify',
  displayName: 'AltTextify',
  description: 'Generate SEO-optimized alt text for images via the AltTextify API.',
  auth: { kind: 'api-key', hint: 'AltTextify API key (X-API-Key header).' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.alttextify.net/api/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  capabilities: [
    {
      name: 'generate.alt.text',
      class: 'mutation',
      description: 'Generate alt text for an image encoded as a data URL or raw base64 payload.',
      parameters: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description: 'Image payload as a data URL (e.g. data:image/jpeg;base64,...) or raw base64 string.',
          },
          lang: {
            type: 'string',
            description: 'Language code for the generated alt text (e.g. en, es, fr).',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords/phrases to bias the generated alt text toward.',
          },
          negative_keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords/phrases to exclude from the generated alt text.',
          },
          async: {
            type: 'boolean',
            description: 'When true, returns a job handle instead of the alt text directly.',
          },
        },
        required: ['image'],
      },
      request: {
        method: 'POST',
        path: '/image/raw',
        body: {
          image: '{image}',
          lang: '{lang}',
          keywords: '{keywords}',
          negative_keywords: '{negative_keywords}',
          async: '{async}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
