import { declarativeRestConnector } from './declarative-rest.js'

export const googleSearchConnector = declarativeRestConnector({
  kind: 'google-search',
  displayName: 'Google Search',
  description: 'Search using Vertex AI Search (Discovery Engine).',
  auth: {
    kind: 'api-key',
    hint: 'Google Cloud API key with Vertex AI Search access. Provide project ID and Vertex AI Search app (engine) ID per request.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://discoveryengine.googleapis.com/v1',
  test: { method: 'GET', path: '/projects/{projectId}/locations/global/collections/default_collection/dataStores' },
  capabilities: [
    {
      name: 'search',
      class: 'read',
      description: 'Run a Vertex AI Search (Discovery Engine) query against a configured search app/engine.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Google Cloud project ID hosting the Vertex AI Search engine.' },
          appId: { type: 'string', description: 'Vertex AI Search app (engine) ID.' },
          query: { type: 'string', description: 'The query text to search.' },
          userPseudoId: {
            type: 'string',
            description: 'Pseudonymized identifier for the user (max 128 chars). Improves personalization.',
          },
        },
        required: ['projectId', 'appId', 'query'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/locations/global/collections/default_collection/engines/{appId}/servingConfigs/default_search:search',
        body: { query: '{query}', userPseudoId: '{userPseudoId}' },
      },
    },
  ],
})
