import { declarativeRestConnector } from './declarative-rest.js'

export const campaignMonitorConnector = declarativeRestConnector({
  kind: 'campaign-monitor',
  displayName: 'Campaign Monitor',
  description:
    'Manage Campaign Monitor subscribers across lists: add, update details, unsubscribe, and lookup.',
  auth: { kind: 'api-key', hint: 'Campaign Monitor API key from Account Settings > API keys.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.createsend.com/api/v3.3',
  test: { method: 'GET', path: '/clients.json' },
  capabilities: [
    {
      name: 'subscriber.add',
      class: 'mutation',
      description: 'Add a subscriber to a list (matches Campaign Monitor "Add subscriber to list").',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          emailAddress: { type: 'string' },
          name: { type: 'string' },
          mobileNumber: { type: 'string' },
          customFields: { type: 'array' },
          consentToTrack: { type: 'string', enum: ['Yes', 'No', 'Unchanged'] },
          consentToSendSms: { type: 'string', enum: ['Yes', 'No', 'Unchanged'] },
          resubscribe: { type: 'boolean' },
          restartSubscriptionBasedAutoresponders: { type: 'boolean' },
        },
        required: ['listId', 'emailAddress', 'consentToTrack'],
      },
      request: {
        method: 'POST',
        path: '/subscribers/{listId}.json',
        body: {
          EmailAddress: '{emailAddress}',
          Name: '{name}',
          MobileNumber: '{mobileNumber}',
          CustomFields: '{customFields}',
          ConsentToTrack: '{consentToTrack}',
          ConsentToSendSms: '{consentToSendSms}',
          Resubscribe: '{resubscribe}',
          RestartSubscriptionBasedAutoresponders: '{restartSubscriptionBasedAutoresponders}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriber.update',
      class: 'mutation',
      description: 'Update an existing subscriber on a list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          email: { type: 'string' },
          newEmailAddress: { type: 'string' },
          name: { type: 'string' },
          mobileNumber: { type: 'string' },
          customFields: { type: 'array' },
          consentToTrack: { type: 'string', enum: ['Yes', 'No', 'Unchanged'] },
          consentToSendSms: { type: 'string', enum: ['Yes', 'No', 'Unchanged'] },
          resubscribe: { type: 'boolean' },
          restartSubscriptionBasedAutoresponders: { type: 'boolean' },
        },
        required: ['listId', 'email', 'consentToTrack'],
      },
      request: {
        method: 'PUT',
        path: '/subscribers/{listId}.json',
        query: { email: '{email}' },
        body: {
          EmailAddress: '{newEmailAddress}',
          Name: '{name}',
          MobileNumber: '{mobileNumber}',
          CustomFields: '{customFields}',
          ConsentToTrack: '{consentToTrack}',
          ConsentToSendSms: '{consentToSendSms}',
          Resubscribe: '{resubscribe}',
          RestartSubscriptionBasedAutoresponders: '{restartSubscriptionBasedAutoresponders}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscriber.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe a subscriber from a list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          emailAddress: { type: 'string' },
        },
        required: ['listId', 'emailAddress'],
      },
      request: {
        method: 'POST',
        path: '/subscribers/{listId}/unsubscribe.json',
        body: { EmailAddress: '{emailAddress}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriber.find',
      class: 'read',
      description: 'Look up a subscriber by email address on a list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          email: { type: 'string' },
          includeTrackingPreference: { type: 'boolean' },
        },
        required: ['listId', 'email'],
      },
      request: {
        method: 'GET',
        path: '/subscribers/{listId}.json',
        query: {
          email: '{email}',
          includetrackingpreference: '{includeTrackingPreference}',
        },
      },
    },
  ],
})
