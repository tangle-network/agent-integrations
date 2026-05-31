import { declarativeRestConnector } from './declarative-rest.js'

export const hystructConnector = declarativeRestConnector({
  kind: 'hystruct',
  displayName: 'Hystruct',
  description: 'AI-powered document structuring and data extraction.',
  auth: { kind: 'api-key', hint: 'Hystruct API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hystruct.com/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'job.create',
      class: 'mutation',
      description: 'Create a document extraction job.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'The ID of the workflow to run' },
          markdown: { type: 'string', description: 'The markdown content to structure' },
        },
        required: ['workflowId', 'markdown'],
      },
      request: {
        method: 'POST',
        path: '/job/create',
        body: {
          workflowId: '{workflowId}',
          markdown: '{markdown}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
