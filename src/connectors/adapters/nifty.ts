import { declarativeRestConnector } from './declarative-rest.js'

export const niftyConnector = declarativeRestConnector({
  kind: 'nifty',
  displayName: 'Nifty',
  description: 'Project management made simple. Create and manage tasks in Nifty.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.nifty.com/oauth/authorize',
    tokenUrl: 'https://api.nifty.com/oauth/token',
    scopes: ['tasks:write', 'tasks:read'],
    clientIdEnv: 'NIFTY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NIFTY_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.nifty.com/v1',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task in Nifty.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          assignee_id: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          due_date: { type: 'string' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/tasks',
        body: {
          title: '{title}',
          description: '{description}',
          assignee_id: '{assignee_id}',
          status: '{status}',
          priority: '{priority}',
          due_date: '{due_date}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['tasks:write'],
    },
  ],
})
