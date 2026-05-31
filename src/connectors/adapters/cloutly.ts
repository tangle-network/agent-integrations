import { declarativeRestConnector } from './declarative-rest.js'

export const cloutlyConnector = declarativeRestConnector({
  kind: 'cloutly',
  displayName: 'Cloutly',
  description: 'Send review-invite requests to Cloutly customers via the public review-management API.',
  auth: {
    kind: 'api-key',
    hint: 'Cloutly API key, forwarded as the x-api-key header alongside a fixed x-app identifier.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.cloutly.com/api/v1',
  test: { method: 'POST', path: '/send-review-invite' },
  capabilities: [
    {
      name: 'reviews.sendInvite',
      class: 'mutation',
      description:
        'Send a review invite for a customer through a Cloutly campaign. Either email or phoneNumber must be provided as the delivery channel.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: {
            type: 'string',
            description: 'Customer email; required if phoneNumber is empty.',
          },
          phoneNumber: {
            type: 'string',
            description: 'Customer phone number; required if email is empty.',
          },
          sourceCustomerId: { type: 'string' },
          businessId: { type: 'string' },
          campaignId: { type: 'string' },
          inviteDelayDays: {
            type: 'integer',
            description: 'Days to delay the invite before send.',
          },
          salesRepEmail: {
            type: 'string',
            description: 'Email of the sales rep to associate with the review and customer.',
          },
        },
        required: ['firstName', 'businessId', 'campaignId'],
      },
      request: {
        method: 'POST',
        path: '/send-review-invite',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          channel: {
            email: '{email}',
            phoneNumber: '{phoneNumber}',
          },
          source: 'api',
          sourceCustomerId: '{sourceCustomerId}',
          businessId: '{businessId}',
          campaignId: '{campaignId}',
          inviteDelayDays: '{inviteDelayDays}',
          salesRepEmail: '{salesRepEmail}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
