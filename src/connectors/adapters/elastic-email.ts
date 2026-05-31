import { declarativeRestConnector } from './declarative-rest.js'

const contactPayload = {
  type: 'object',
  properties: {
    Email: { type: 'string' },
    Status: { type: 'string' },
    FirstName: { type: 'string' },
    LastName: { type: 'string' },
    CustomFields: { type: 'object' },
    ConsentIP: { type: 'string' },
    ConsentDate: { type: 'string' },
    ConsentTracking: { type: 'string' },
  },
  required: ['Email'],
}

const campaignContent = {
  type: 'object',
  properties: {
    From: { type: 'string' },
    ReplyTo: { type: 'string' },
    Subject: { type: 'string' },
    PoolName: { type: 'string' },
    ChannelName: { type: 'string' },
    Encoding: { type: 'string' },
    EnableTracking: { type: 'boolean' },
    TemplateName: { type: 'string' },
    AttachFiles: { type: 'array', items: { type: 'string' } },
    Merge: { type: 'object' },
    Body: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ContentType: { type: 'string' },
          Content: { type: 'string' },
          Charset: { type: 'string' },
        },
        required: ['ContentType', 'Content'],
      },
    },
  },
  required: ['From'],
}

export const elasticEmailConnector = declarativeRestConnector({
  kind: 'elastic-email',
  displayName: 'Elastic Email',
  description:
    'Send transactional email, manage contacts, segments, and campaigns through the Elastic Email v4 REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Elastic Email API key (Settings → API → Create Additional API Key) with Contacts, Campaigns, and Email scopes.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.elasticemail.com',
  credentialPlacement: { kind: 'header', header: 'X-ElasticEmail-ApiKey' },
  test: { method: 'GET', path: '/v4/account/load' },
  capabilities: [
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts in the account.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/v4/contacts',
        query: { search: '{search}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'contacts.add',
      class: 'mutation',
      description: 'Bulk add contacts (upsert by email).',
      parameters: {
        type: 'object',
        properties: {
          contacts: { type: 'array', items: contactPayload },
        },
        required: ['contacts'],
      },
      request: { method: 'POST', path: '/v4/contacts', body: '{contacts}' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a single contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          status: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          customFields: { type: 'object' },
          consentIP: { type: 'string' },
          consentDate: { type: 'string' },
          consentTracking: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v4/contacts',
        body: {
          Email: '{email}',
          Status: '{status}',
          FirstName: '{firstName}',
          LastName: '{lastName}',
          CustomFields: '{customFields}',
          ConsentIP: '{consentIP}',
          ConsentDate: '{consentDate}',
          ConsentTracking: '{consentTracking}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          status: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          customFields: { type: 'object' },
          consentIP: { type: 'string' },
          consentDate: { type: 'string' },
          consentTracking: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'PUT',
        path: '/v4/contacts/{email}',
        body: {
          Status: '{status}',
          FirstName: '{firstName}',
          LastName: '{lastName}',
          CustomFields: '{customFields}',
          ConsentIP: '{consentIP}',
          ConsentDate: '{consentDate}',
          ConsentTracking: '{consentTracking}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe one or more contacts from the account.',
      parameters: {
        type: 'object',
        properties: {
          emails: { type: 'array', items: { type: 'string' } },
        },
        required: ['emails'],
      },
      request: {
        method: 'PUT',
        path: '/v4/contacts/unsubscribe',
        body: { Emails: '{emails}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'segments.create',
      class: 'mutation',
      description: 'Create a new contact segment from a rule expression.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rule: { type: 'string' },
        },
        required: ['name', 'rule'],
      },
      request: {
        method: 'POST',
        path: '/v4/segments',
        body: { Name: '{name}', Rule: '{rule}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns filtered by name or with pagination.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/v4/campaigns',
        query: { search: '{search}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create a new email campaign.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          recipients: { type: 'object' },
          content: campaignContent,
          status: { type: 'string' },
          options: { type: 'object' },
        },
        required: ['name', 'recipients', 'content'],
      },
      request: {
        method: 'POST',
        path: '/v4/campaigns',
        body: {
          Name: '{name}',
          Recipients: '{recipients}',
          Content: '{content}',
          Status: '{status}',
          Options: '{options}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.update',
      class: 'mutation',
      description: 'Update an existing campaign by name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          recipients: { type: 'object' },
          content: campaignContent,
          status: { type: 'string' },
          options: { type: 'object' },
        },
        required: ['name'],
      },
      request: {
        method: 'PUT',
        path: '/v4/campaigns/{name}',
        body: {
          Name: '{name}',
          Recipients: '{recipients}',
          Content: '{content}',
          Status: '{status}',
          Options: '{options}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'email.send',
      class: 'mutation',
      description: 'Send a transactional email through /v4/emails/transactional.',
      parameters: {
        type: 'object',
        properties: {
          recipients: { type: 'object' },
          content: campaignContent,
          options: {
            type: 'object',
            properties: {
              TimeOffset: { type: 'integer' },
              PoolName: { type: 'string' },
              ChannelName: { type: 'string' },
              Encoding: { type: 'string' },
              TrackOpens: { type: 'boolean' },
              TrackClicks: { type: 'boolean' },
            },
          },
          merge: { type: 'object' },
        },
        required: ['recipients', 'content'],
      },
      request: {
        method: 'POST',
        path: '/v4/emails/transactional',
        body: {
          Recipients: '{recipients}',
          Content: '{content}',
          Options: '{options}',
          Merge: '{merge}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
