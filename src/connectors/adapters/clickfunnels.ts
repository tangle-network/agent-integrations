import { declarativeRestConnector } from './declarative-rest.js'

export const clickfunnelsConnector = declarativeRestConnector({
  kind: 'clickfunnels',
  displayName: 'ClickFunnels',
  description: 'Create and manage contacts, opportunities, and tags in ClickFunnels.',
  auth: { kind: 'api-key', hint: 'ClickFunnels API key from account settings.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.clickfunnels.com/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search contacts by email or ID.',
      parameters: {
        type: 'object',
        properties: { searchTerm: { type: 'string' } },
        required: ['searchTerm'],
      },
      request: { method: 'GET', path: '/contacts', query: { search: '{searchTerm}' } },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create or update a contact.',
      parameters: {
        type: 'object',
        properties: {
          emailAddress: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phoneNumber: { type: 'string' },
          customAttributes: { type: 'object' },
        },
        required: ['emailAddress'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{emailAddress}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          phone: '{phoneNumber}',
          custom: '{customAttributes}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'opportunities.create',
      class: 'mutation',
      description: 'Create an opportunity.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
          closedAt: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/opportunities',
        body: { name: '{name}', value: '{value}', closedAt: '{closedAt}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tags.apply',
      class: 'mutation',
      description: 'Apply a tag to a contact.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' }, tagId: { type: 'string' } },
        required: ['contactId', 'tagId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/tags/{tagId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tags.remove',
      class: 'mutation',
      description: 'Remove a tag from a contact.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' }, tagId: { type: 'string' } },
        required: ['contactId', 'tagId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}/tags/{tagId}',
      },
    },
    {
      name: 'courses.enroll',
      class: 'mutation',
      description: 'Enroll a contact into a course.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' }, courseId: { type: 'string' } },
        required: ['contactId', 'courseId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/enrollments',
        body: { courseId: '{courseId}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
