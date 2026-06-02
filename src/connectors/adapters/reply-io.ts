import { declarativeRestConnector } from './declarative-rest.js'

export const replyIoConnector = declarativeRestConnector({
  kind: 'reply-io',
  displayName: 'Reply.io',
  description: 'Sales engagement platform for contacts, campaigns, and outbound outreach workflows.',
  auth: { kind: 'api-key', hint: 'Reply.io API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.reply.io/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact or update an existing contact by email.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email address.' },
          firstName: { type: 'string', description: 'Contact first name.' },
          lastName: { type: 'string', description: 'Contact last name.' },
          company: { type: 'string', description: 'Contact company.' },
          title: { type: 'string', description: 'Contact job title.' },
          phone: { type: 'string', description: 'Contact phone number.' },
          linkedInProfile: { type: 'string', description: 'Contact LinkedIn profile URL.' },
          notes: { type: 'string', description: 'Internal notes about the contact.' },
          city: { type: 'string', description: 'Contact city.' },
          state: { type: 'string', description: 'Contact state or province.' },
          country: { type: 'string', description: 'Contact country.' },
          timeZoneId: { type: 'string', description: 'IANA timezone identifier.' },
        },
        required: ['email', 'firstName'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          company: '{company}',
          title: '{title}',
          phone: '{phone}',
          linkedInProfile: '{linkedInProfile}',
          notes: '{notes}',
          city: '{city}',
          state: '{state}',
          country: '{country}',
          timeZoneId: '{timeZoneId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.push_to_campaign',
      class: 'mutation',
      description: 'Push an existing contact to a campaign.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
          campaignId: { type: 'string', description: 'Campaign ID to push contact into.' },
          forcePush: { type: 'boolean', description: 'Force push even if contact is in another active campaign.' },
        },
        required: ['contactId', 'campaignId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/push-to-campaign',
        body: {
          campaignId: '{campaignId}',
          forcePush: '{forcePush}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.create_and_push',
      class: 'mutation',
      description: 'Create a new contact and push directly to a campaign.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email address.' },
          firstName: { type: 'string', description: 'Contact first name.' },
          lastName: { type: 'string', description: 'Contact last name.' },
          company: { type: 'string', description: 'Contact company.' },
          title: { type: 'string', description: 'Contact job title.' },
          phone: { type: 'string', description: 'Contact phone number.' },
          linkedInProfile: { type: 'string', description: 'Contact LinkedIn profile URL.' },
          notes: { type: 'string', description: 'Internal notes about the contact.' },
          city: { type: 'string', description: 'Contact city.' },
          state: { type: 'string', description: 'Contact state or province.' },
          country: { type: 'string', description: 'Contact country.' },
          timeZoneId: { type: 'string', description: 'IANA timezone identifier.' },
          campaignId: { type: 'string', description: 'Campaign ID to push contact into.' },
          forcePush: { type: 'boolean', description: 'Force push even if contact is in another active campaign.' },
        },
        required: ['email', 'firstName', 'campaignId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/create-and-push',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          company: '{company}',
          title: '{title}',
          phone: '{phone}',
          linkedInProfile: '{linkedInProfile}',
          notes: '{notes}',
          city: '{city}',
          state: '{state}',
          country: '{country}',
          timeZoneId: '{timeZoneId}',
          campaignId: '{campaignId}',
          forcePush: '{forcePush}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Retrieve a contact by ID.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'GET',
        path: '/contacts/{contactId}',
      },
    },
    {
      name: 'contacts.mark_replied',
      class: 'mutation',
      description: 'Mark a contact as replied.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/mark-replied',
        body: {},
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.mark_finished',
      class: 'mutation',
      description: 'Mark a contact as finished.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/mark-finished',
        body: {},
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.remove_from_campaign',
      class: 'mutation',
      description: 'Remove a contact from a specific campaign.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
          campaignId: { type: 'string', description: 'Campaign ID to remove contact from.' },
        },
        required: ['contactId', 'campaignId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/remove-from-campaign',
        body: {
          campaignId: '{campaignId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.remove_from_all_campaigns',
      class: 'mutation',
      description: 'Remove a contact from all campaigns.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/remove-from-all-campaigns',
        body: {},
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact permanently.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID.' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns visible to the authenticated account.',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'Optional campaign state filter (e.g. active, paused, new).' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/campaigns',
        query: { state: '{state}' },
      },
    },
    {
      name: 'campaigns.start',
      class: 'mutation',
      description: 'Start (or resume) a campaign by id.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign id to start.' },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'POST',
        path: '/campaigns/{campaignId}/start',
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.pause',
      class: 'mutation',
      description: 'Pause a running campaign by id.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign id to pause.' },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'POST',
        path: '/campaigns/{campaignId}/pause',
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'templates.create',
      class: 'mutation',
      description: 'Create a reusable email template.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name.' },
          subject: { type: 'string', description: 'Email subject.' },
          body: { type: 'string', description: 'Email body (HTML or text).' },
        },
        required: ['name', 'subject', 'body'],
      },
      request: {
        method: 'POST',
        path: '/emailTemplates',
        body: {
          name: '{name}',
          subject: '{subject}',
          body: '{body}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
