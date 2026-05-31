import { declarativeRestConnector } from './declarative-rest.js'

export const leexiConnector = declarativeRestConnector({
  kind: 'leexi',
  displayName: 'Leexi',
  description: 'Fetch call recordings, transcripts, and summaries from the Leexi AI Notetaker.',
  auth: {
    kind: 'api-key',
    hint: 'Leexi API Key ID and Key Secret, issued at app.leexi.ai/settings/api_keys and sent as HTTP Basic credentials.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://public-api.leexi.ai/v1',
  test: { method: 'GET', path: '/users' },
  capabilities: [
    {
      name: 'calls.get',
      class: 'read',
      description: 'Get a single Leexi call by its identifier, including transcript and summary metadata.',
      parameters: {
        type: 'object',
        properties: {
          callId: {
            type: 'string',
            description: 'Leexi call identifier as returned by the new.call.created webhook.',
          },
        },
        required: ['callId'],
      },
      request: { method: 'GET', path: '/calls/{callId}' },
    },
  ],
})
