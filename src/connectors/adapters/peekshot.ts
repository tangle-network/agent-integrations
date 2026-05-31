import { declarativeRestConnector } from './declarative-rest.js'

export const peekshotConnector = declarativeRestConnector({
  kind: 'peekshot',
  displayName: 'PeekShot',
  description: 'Capture screenshots of web pages with customizable dimensions, CSS, and JavaScript injection.',
  auth: { kind: 'api-key', hint: 'PeekShot API key or target URL.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.peekshot.io',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'capture.screenshot',
      class: 'mutation',
      description: 'Capture a screenshot of a target URL with optional customization.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to capture.' },
          width: { type: 'integer', description: 'Custom screenshot width in pixels.' },
          height: { type: 'integer', description: 'Custom screenshot height in pixels.' },
          file_type: { type: 'string', description: 'Output format: jpeg, png, webp.' },
          inject_css: { type: 'string', description: 'Custom CSS to apply before capture.' },
          inject_js: { type: 'string', description: 'Custom JavaScript to execute before capture.' },
          full_page: { type: 'boolean', description: 'Capture the entire page instead of viewport.' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/screenshot',
        body: {
          url: '{url}',
          width: '{width}',
          height: '{height}',
          file_type: '{file_type}',
          inject_css: '{inject_css}',
          inject_js: '{inject_js}',
          full_page: '{full_page}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
