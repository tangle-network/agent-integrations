import { declarativeRestConnector } from './declarative-rest.js'

export const pollybotAiConnector = declarativeRestConnector({
  kind: 'pollybot-ai',
  displayName: 'PollyBot AI',
  description: 'Automate lead management with PollyBot AI chatbot integration.',
  auth: {
    kind: 'api-key',
    hint: 'PollyBot API Key starting with your organization identifier.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.pollybot.ai/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  test: { method: 'GET', path: '/chatbots' },
  capabilities: [
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create a new lead in PollyBot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The unique ID for the specific chatbot' },
          name: { type: 'string', description: 'Lead name' },
          email: { type: 'string', description: 'Valid email address' },
          phone: { type: 'string', description: 'Phone number (optional)' },
          source: { type: 'string', description: 'Lead source (e.g., website, referral)' },
          status: { type: 'string', description: 'Lead status' },
          metadata: { type: 'object', description: 'Custom data as JSON object' },
        },
        required: ['chatbotId', 'name', 'email'],
      },
      request: {
        method: 'POST',
        path: '/chatbots/{chatbotId}/leads',
        body: {
          name: '{name}',
          email: '{email}',
          phone: '{phone}',
          source: '{source}',
          status: '{status}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Get a specific lead by ID.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The chatbot ID' },
          leadId: { type: 'string', description: 'The unique identifier of the lead' },
        },
        required: ['chatbotId', 'leadId'],
      },
      request: {
        method: 'GET',
        path: '/chatbots/{chatbotId}/leads/{leadId}',
      },
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Update an existing lead.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The chatbot ID' },
          leadId: { type: 'string', description: 'The unique identifier of the lead to update' },
          name: { type: 'string', description: 'Lead name' },
          email: { type: 'string', description: 'Email address' },
          phone: { type: 'string', description: 'Phone number' },
          source: { type: 'string', description: 'Lead source' },
          status: { type: 'string', description: 'Lead status' },
          metadata: { type: 'object', description: 'Custom data as JSON object' },
        },
        required: ['chatbotId', 'leadId'],
      },
      request: {
        method: 'PUT',
        path: '/chatbots/{chatbotId}/leads/{leadId}',
        body: {
          name: '{name}',
          email: '{email}',
          phone: '{phone}',
          source: '{source}',
          status: '{status}',
          metadata: '{metadata}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'leads.delete',
      class: 'mutation',
      description: 'Delete a lead.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The chatbot ID' },
          leadId: { type: 'string', description: 'The unique identifier of the lead to delete' },
        },
        required: ['chatbotId', 'leadId'],
      },
      request: {
        method: 'DELETE',
        path: '/chatbots/{chatbotId}/leads/{leadId}',
      },
      externalEffect: true,
    },
    {
      name: 'leads.list',
      class: 'read',
      description: 'List leads for a chatbot.',
      parameters: {
        type: 'object',
        properties: {
          chatbotId: { type: 'string', description: 'The chatbot ID' },
          page: { type: 'integer', description: 'Page number (0-indexed)' },
          limit: { type: 'integer', description: 'Max 100 results per page' },
          search: { type: 'string', description: 'Search in name and email fields' },
        },
        required: ['chatbotId'],
      },
      request: {
        method: 'GET',
        path: '/chatbots/{chatbotId}/leads',
        query: {
          page: '{page}',
          limit: '{limit}',
          search: '{search}',
        },
      },
    },
  ],
})
