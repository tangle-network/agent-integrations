import { declarativeRestConnector } from './declarative-rest.js'

export const mindStudioConnector = declarativeRestConnector({
  kind: 'mind-studio',
  displayName: 'MindStudio',
  description: 'Run MindStudio apps and workflows with variable inputs.',
  auth: { kind: 'api-key', hint: 'MindStudio API Bearer token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.mindstudio.ai/api',
  test: { method: 'GET', path: '/v1/health' },
  capabilities: [
    {
      name: 'workflows.run',
      class: 'mutation',
      description: 'Run a MindStudio workflow by App ID.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'The MindStudio app ID to run.' },
          workflow: { type: 'string', description: 'Workflow name to run (without the .flow extension).' },
          variables: { type: 'object', description: 'Key-value variables passed to the app.' },
          callbackUrl: { type: 'string', description: 'URL to receive the execution result asynchronously.' },
          includeBillingCost: { type: 'boolean', description: 'Return the billing cost in the response.' },
        },
        required: ['appId'],
      },
      request: {
        method: 'POST',
        path: '/v1/workflow/run',
        body: {
          appId: '{appId}',
          workflow: '{workflow}',
          variables: '{variables}',
          callbackUrl: '{callbackUrl}',
          includeBillingCost: '{includeBillingCost}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
