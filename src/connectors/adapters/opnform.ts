import { declarativeRestConnector } from './declarative-rest.js'

export const opnformConnector = declarativeRestConnector({
  kind: 'opnform',
  displayName: 'Opnform',
  description: 'Create beautiful online forms and surveys with unlimited fields and submissions.',
  auth: { kind: 'api-key', hint: 'Opnform API key.' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.opnform.com/api',
  test: { method: 'GET', path: '/v1/user' },
  capabilities: [
    {
      name: 'webhooks.configure',
      class: 'mutation',
      description: 'Configure a webhook to receive form submission events.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          webhookUrl: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
        },
        required: ['formId', 'webhookUrl'],
      },
      request: {
        method: 'POST',
        path: '/v1/forms/{formId}/webhooks',
        body: { webhook_url: '{webhookUrl}', events: '{events}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'forms.get',
      class: 'read',
      description: 'Retrieve details of a specific form.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/v1/forms/{formId}' },
    },
    {
      name: 'forms.list',
      class: 'read',
      description: 'List all forms in the workspace.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' }, offset: { type: 'integer' } },
      },
      request: { method: 'GET', path: '/v1/forms', query: { limit: '{limit}', offset: '{offset}' } },
    },
    {
      name: 'submissions.list',
      class: 'read',
      description: 'List submissions for a specific form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/v1/forms/{formId}/submissions',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'submissions.get',
      class: 'read',
      description: 'Retrieve a specific form submission.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' }, submissionId: { type: 'string' } },
        required: ['formId', 'submissionId'],
      },
      request: { method: 'GET', path: '/v1/forms/{formId}/submissions/{submissionId}' },
    },
  ],
})
