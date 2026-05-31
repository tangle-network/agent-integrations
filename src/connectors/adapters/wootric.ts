import { declarativeRestConnector } from './declarative-rest.js'

export const wootricConnector = declarativeRestConnector({
  kind: 'wootric',
  displayName: 'Wootric',
  description: 'Measure and boost customer happiness through surveys and feedback.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://oauth.wootric.com/oauth/authorize',
    tokenUrl: 'https://oauth.wootric.com/oauth/token',
    scopes: [],
    clientIdEnv: 'WOOTRIC_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WOOTRIC_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.wootric.com/v1',
  test: { method: 'GET', path: '/ping' },
  capabilities: [
    {
      name: 'surveys.create',
      class: 'mutation',
      description: 'Create a Wootric survey.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the user to send survey to.' },
          firstName: { type: 'string', description: 'First name of the user.' },
          lastName: { type: 'string', description: 'Last name of the user.' },
          customAttributes: { type: 'object', description: 'Custom user attributes.' },
          externalId: { type: 'string', description: 'External user ID.' },
          isRecipient: { type: 'boolean', description: 'Mark as recipient.' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/survey_responses',
        body: {
          survey_response: {
            email: '{email}',
            first_name: '{firstName}',
            last_name: '{lastName}',
            custom_attributes: '{customAttributes}',
            external_id: '{externalId}',
            is_recipient: '{isRecipient}',
          },
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
