import { declarativeRestConnector } from './declarative-rest.js'

export const featheryConnector = declarativeRestConnector({
  kind: 'feathery',
  displayName: 'Feathery',
  description: 'Build powerful forms, workflows, and document automation.',
  auth: { kind: 'api-key', hint: 'Feathery API key.' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.feathery.io/api/v1',
  test: { method: 'GET', path: '/forms' },
  capabilities: [
    {
      name: 'forms.create',
      class: 'mutation',
      description: 'Create a new form.',
      parameters: {
        type: 'object',
        properties: {
          form_name: { type: 'string' },
          template_form_id: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['form_name', 'template_form_id'],
      },
      request: {
        method: 'POST',
        path: '/forms',
        body: {
          form_name: '{form_name}',
          template_form_id: '{template_form_id}',
          enabled: '{enabled}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'forms.update',
      class: 'mutation',
      description: 'Update an existing form.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          form_name: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['form_id'],
      },
      request: {
        method: 'PATCH',
        path: '/forms/{form_id}',
        body: {
          form_name: '{form_name}',
          enabled: '{enabled}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'forms.delete',
      class: 'mutation',
      description: 'Delete a form.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
        },
        required: ['form_id'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{form_id}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'submissions.list',
      class: 'read',
      description: 'List form submissions.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          completed: { type: 'boolean' },
        },
        required: ['form_id'],
      },
      request: {
        method: 'GET',
        path: '/forms/{form_id}/submissions',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          completed: '{completed}',
        },
      },
    },
    {
      name: 'submissions.export',
      class: 'mutation',
      description: 'Export submission as PDF.',
      parameters: {
        type: 'object',
        properties: {
          submission_id: { type: 'string' },
        },
        required: ['submission_id'],
      },
      request: {
        method: 'POST',
        path: '/submissions/{submission_id}/export-pdf',
      },
      cas: 'native-idempotency',
    },
  ],
})
