import { declarativeRestConnector } from './declarative-rest.js'

// Serper — Run fast Google searches (web, news, images, places, and scholar) and get structured SERP results as JSON.
// Auth: api-key. Base: https://google.serper.dev. Docs: https://serper.dev/
export const serperConnector = declarativeRestConnector({
  kind: 'serper',
  displayName: 'Serper',
  description: 'Run fast Google searches (web, news, images, places, and scholar) and get structured SERP results as JSON.',
  auth: {
    kind: 'api-key',
    hint: 'API key from your serper.dev dashboard. Sent in the X-API-KEY request header.',
  },
  category: 'market-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://google.serper.dev',
  credentialPlacement: { kind: 'header', header: 'X-API-KEY' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'POST', path: '/search', body: { q: 'OpenAI' } },
  capabilities: [
    {
      name: 'search.web',
      class: 'read',
      description: 'Run a Google web search and return organic results, knowledge graph, answer box, and related searches.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'The search query.' },
          gl: {
            type: 'string',
            description: 'Two-letter country code for geo-targeting, e.g. us.',
          },
          hl: { type: 'string', description: 'Two-letter language code, e.g. en.' },
          num: { type: 'integer', description: 'Number of results to return.' },
          page: { type: 'integer', description: 'Results page number.' },
        },
        required: ['q'],
      },
      request: {
        method: 'POST',
        path: '/search',
        body: { q: '{q}', gl: '{gl}', hl: '{hl}', num: '{num}', page: '{page}' },
      },
    },
    {
      name: 'search.news',
      class: 'read',
      description: 'Run a Google News search and return structured news results.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'The news search query.' },
          gl: { type: 'string', description: 'Two-letter country code.' },
          hl: { type: 'string', description: 'Two-letter language code.' },
        },
        required: ['q'],
      },
      request: { method: 'POST', path: '/news', body: { q: '{q}', gl: '{gl}', hl: '{hl}' } },
    },
    {
      name: 'search.places',
      class: 'read',
      description: 'Run a Google Maps/Places search and return structured place results.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'The places search query.' },
          gl: { type: 'string', description: 'Two-letter country code.' },
        },
        required: ['q'],
      },
      request: { method: 'POST', path: '/places', body: { q: '{q}', gl: '{gl}' } },
    },
    {
      name: 'search.scholar',
      class: 'read',
      description: 'Run a Google Scholar search and return structured academic results.',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: 'The scholar search query.' } },
        required: ['q'],
      },
      request: { method: 'POST', path: '/scholar', body: { q: '{q}' } },
    },
    {
      name: 'search.images',
      class: 'read',
      description: 'Run a Google Images search and return structured image results.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'The image search query.' },
          gl: { type: 'string', description: 'Two-letter country code.' },
        },
        required: ['q'],
      },
      request: { method: 'POST', path: '/images', body: { q: '{q}', gl: '{gl}' } },
    },
  ],
})
