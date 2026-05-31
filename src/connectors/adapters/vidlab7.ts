import { declarativeRestConnector } from './declarative-rest.js'

export const vidlab7Connector = declarativeRestConnector({
  kind: 'vidlab7',
  displayName: 'VidLab7',
  description: 'Generate AI avatar videos with configurable scripts, voices, and styles.',
  auth: { kind: 'api-key', hint: 'VidLab7 API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vidlab7.com/v1',
  test: { method: 'GET', path: '/avatars' },
  capabilities: [
    {
      name: 'videos.create',
      class: 'mutation',
      description: 'Create an AI avatar video with a custom script and voice.',
      parameters: {
        type: 'object',
        properties: {
          avatarId: { type: 'string' },
          script: { type: 'string' },
          voiceId: { type: 'string' },
          webhookUrl: { type: 'string' },
          similarity_boost: { type: 'number' },
          use_speaker_boost: { type: 'boolean' },
          style: { type: 'number' },
          stability: { type: 'number' },
          waitForCompletion: { type: 'boolean' },
        },
        required: ['avatarId', 'script', 'voiceId', 'webhookUrl'],
      },
      request: {
        method: 'POST',
        path: '/videos',
        body: {
          avatarId: '{avatarId}',
          script: '{script}',
          voiceId: '{voiceId}',
          webhookUrl: '{webhookUrl}',
          similarity_boost: '{similarity_boost}',
          use_speaker_boost: '{use_speaker_boost}',
          style: '{style}',
          stability: '{stability}',
          waitForCompletion: '{waitForCompletion}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
