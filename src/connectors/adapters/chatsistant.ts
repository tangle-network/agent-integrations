import { declarativeRestConnector } from './declarative-rest.js'

export const chatsistantConnector = declarativeRestConnector({
  kind: 'chatsistant',
  displayName: 'Chatsistant',
  description: 'Send messages to a Chatsistant chatbot.',
  auth: { kind: 'api-key', hint: 'Chatsistant API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chatsistant.com',
  test: { method: 'GET', path: '/v1/health' },
  capabilities: [
    {
      name: 'message.send',
      class: 'mutation',
      description: 'Send a message to a Chatsistant chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbot_uuid: { type: 'string' },
          query: { type: 'string' },
          session_uuid: { type: 'string' },
          markdown: { type: 'boolean' },
        },
        required: ['chatbot_uuid', 'query', 'markdown'],
      },
      request: {
        method: 'POST',
        path: '/v1/message/send',
        body: {
          chatbot_uuid: '{chatbot_uuid}',
          query: '{query}',
          session_uuid: '{session_uuid}',
          markdown: '{markdown}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
