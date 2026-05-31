import { declarativeRestConnector } from './declarative-rest.js'

export const autocallsConnector = declarativeRestConnector({
  kind: 'autocalls',
  displayName: 'Autocalls',
  description: 'Place outbound calls, send SMS, and manage Autocalls campaign leads.',
  auth: {
    kind: 'api-key',
    hint: 'Autocalls API key — create one in app.autocalls.ai and send it as a bearer token.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.autocalls.ai',
  test: { method: 'GET', path: '/api/user/me' },
  capabilities: [
    {
      name: 'make.phone.call',
      class: 'mutation',
      description: 'Call a customer phone number using a selected Autocalls assistant.',
      parameters: {
        type: 'object',
        properties: {
          assistant: { type: 'string', description: 'Assistant id from /api/user/assistants/outbound.' },
          phone_number: { type: 'string', description: 'Customer phone number to dial.' },
          variables: { type: 'object', description: 'Variables passed to the assistant prompt.' },
        },
        required: ['assistant', 'phone_number'],
      },
      request: {
        method: 'POST',
        path: '/api/user/make_call',
        body: {
          assistant: '{assistant}',
          phone_number: '{phone_number}',
          variables: '{variables}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'add.lead',
      class: 'mutation',
      description: 'Add a lead (primary + optional secondary contacts) to an Autocalls campaign.',
      parameters: {
        type: 'object',
        properties: {
          campaign: { type: 'string', description: 'Campaign id from /api/user/campaigns.' },
          phone_number: { type: 'string' },
          variables: { type: 'object' },
          allow_dupplicate: { type: 'boolean', description: 'Allow re-adding the same phone number.' },
          num_secondary_contacts: { type: 'integer' },
          secondary_contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phone_number: { type: 'string' },
                variables: { type: 'object' },
              },
            },
          },
        },
        required: ['campaign', 'phone_number', 'variables', 'allow_dupplicate'],
      },
      request: {
        method: 'POST',
        path: '/api/user/lead',
        body: {
          campaign: '{campaign}',
          phone_number: '{phone_number}',
          variables: '{variables}',
          allow_dupplicate: '{allow_dupplicate}',
          num_secondary_contacts: '{num_secondary_contacts}',
          secondary_contacts: '{secondary_contacts}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'send.sms',
      class: 'mutation',
      description: 'Send an SMS from an Autocalls-owned phone number to a customer.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'SMS-capable phone number id from /api/user/phone-numbers.' },
          to: { type: 'string', description: 'Customer phone number.' },
          body: { type: 'string', description: 'Message body (max 300 characters).' },
        },
        required: ['from', 'to', 'body'],
      },
      request: {
        method: 'POST',
        path: '/api/user/sms',
        body: {
          from: '{from}',
          to: '{to}',
          body: '{body}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'campaign.control',
      class: 'mutation',
      description: 'Change the status of an Autocalls campaign (start, pause, resume, stop).',
      parameters: {
        type: 'object',
        properties: {
          campaign: { type: 'string', description: 'Campaign id from /api/user/campaigns.' },
          action: {
            type: 'string',
            description: 'Status transition to apply to the campaign.',
            enum: ['start', 'pause', 'resume', 'stop'],
          },
        },
        required: ['campaign', 'action'],
      },
      request: {
        method: 'POST',
        path: '/api/user/campaigns/update-status',
        body: {
          campaign: '{campaign}',
          action: '{action}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'delete.lead',
      class: 'mutation',
      description: 'Delete a lead from Autocalls by id.',
      parameters: {
        type: 'object',
        properties: {
          lead: { type: 'string', description: 'Lead id from /api/user/leads.' },
        },
        required: ['lead'],
      },
      request: {
        method: 'DELETE',
        path: '/api/user/leads/{lead}',
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
