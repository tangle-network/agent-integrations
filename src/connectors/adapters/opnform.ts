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
    {
      name: 'forms.create',
      class: 'mutation',
      description: 'Create a new form.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Form title' },
          description: { type: 'string', description: 'Form description (optional)' },
          properties: {
            type: 'array',
            description: 'Form field definitions',
            items: { type: 'object' },
          },
          settings: { type: 'object', description: 'Form settings (optional)' },
        },
        required: ['title', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/v1/forms',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'forms.update',
      class: 'mutation',
      description: 'Update form schema or settings.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'The form identifier' },
          title: { type: 'string', description: 'Updated form title (optional)' },
          description: { type: 'string', description: 'Updated description (optional)' },
          properties: {
            type: 'array',
            description: 'Updated form field definitions (optional)',
            items: { type: 'object' },
          },
          settings: { type: 'object', description: 'Updated form settings (optional)' },
        },
        required: ['formId'],
      },
      request: {
        method: 'PUT',
        path: '/v1/forms/{formId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'forms.delete',
      class: 'mutation',
      description: 'Delete a form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'The form identifier' },
        },
        required: ['formId'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/forms/{formId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'submissions.delete',
      class: 'mutation',
      description: 'Delete a form submission.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'The form identifier' },
          submissionId: { type: 'string', description: 'The submission identifier' },
        },
        required: ['formId', 'submissionId'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/forms/{formId}/submissions/{submissionId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
