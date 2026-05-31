import { declarativeRestConnector } from './declarative-rest.js'

export const elevenlabsConnector = declarativeRestConnector({
  kind: 'elevenlabs',
  displayName: 'ElevenLabs',
  description: 'Convert text to speech using ElevenLabs AI voice synthesis.',
  auth: { kind: 'api-key', hint: 'ElevenLabs API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.elevenlabs.io',
  test: { method: 'GET', path: '/v1/user' },
  capabilities: [
    {
      name: 'speech.synthesis',
      class: 'mutation',
      description: 'Convert text to speech and return audio.',
      parameters: {
        type: 'object',
        properties: {
          voiceId: { type: 'string', description: 'The voice ID to use for synthesis' },
          text: { type: 'string', description: 'The text to convert to speech' },
          modelId: { type: 'string', description: 'Optional model ID (defaults to eleven_monolingual_v1)' },
        },
        required: ['voiceId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/v1/text-to-speech/{voiceId}',
        body: { text: '{text}', model_id: '{modelId}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
