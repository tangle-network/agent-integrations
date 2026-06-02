import { declarativeRestConnector } from './declarative-rest.js'

export const twinLabsConnector = declarativeRestConnector({
  kind: 'twin-labs',
  displayName: 'Twin Labs',
  description: 'Automate web browsing tasks with AI-driven task execution.',
  auth: { kind: 'api-key', hint: 'Twin Labs API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.twinlabs.ai/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'browsing.start',
      class: 'mutation',
      description: 'Start a new browsing task with a goal and initial URL.',
      parameters: {
        type: 'object',
        properties: {
          startUrl: { type: 'string', description: 'The URL where the browsing task should begin' },
          goal: { type: 'string', description: 'The goal or objective of the browsing task' },
        },
        required: ['startUrl', 'goal'],
      },
      request: { method: 'POST', path: '/browsing/start', body: { startUrl: '{startUrl}', goal: '{goal}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'browsing.stop',
      class: 'mutation',
      description: 'Stop an in-progress browsing session.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Identifier of the browsing session to stop.' },
        },
        required: ['sessionId'],
      },
      request: { method: 'POST', path: '/sessions/{sessionId}/stop' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'browsing.get',
      class: 'read',
      description:
        'Fetch the current state of a browsing session, including status, current URL, and a screenshot URL.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Identifier of the browsing session to inspect.' },
        },
        required: ['sessionId'],
      },
      request: { method: 'GET', path: '/sessions/{sessionId}' },
    },
  ],
})
