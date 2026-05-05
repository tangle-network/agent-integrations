import { declarativeRestConnector } from '@tangle-network/agent-integrations'

export const statusApiConnector = declarativeRestConnector({
  kind: 'status-api',
  displayName: 'Status API',
  description: 'Read service health from an internal status endpoint.',
  auth: { kind: 'api-key', hint: 'Status API token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://status.example.com/api',
  capabilities: [
    {
      name: 'services.get',
      class: 'read',
      description: 'Read one service status.',
      parameters: {
        type: 'object',
        properties: { serviceId: { type: 'string' } },
        required: ['serviceId'],
      },
      request: {
        method: 'GET',
        path: '/services/{serviceId}',
      },
    },
  ],
})
