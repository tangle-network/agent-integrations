import { declarativeRestConnector } from './declarative-rest.js'

// HeyReach — LinkedIn outreach automation at agency scale. List campaigns and lists, add leads to campaigns, look up leads, and read inbox conversations.
// Auth: api-key. Base: https://api.heyreach.io/api/public. Docs: https://documenter.getpostman.com/view/23808049/2sA2xb5F75
export const heyreachConnector = declarativeRestConnector({
  kind: 'heyreach',
  displayName: 'HeyReach',
  description: 'LinkedIn outreach automation at agency scale. List campaigns and lists, add leads to campaigns, look up leads, and read inbox conversations.',
  auth: {
    kind: 'api-key',
    hint: 'Generate an API key in HeyReach (Settings -> Integrations -> Public API). Sent as the X-API-KEY header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.heyreach.io/api/public',
  credentialPlacement: { kind: 'header', header: 'X-API-KEY' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/auth/CheckApiKey' },
  capabilities: [
    {
      name: 'campaign.list',
      class: 'read',
      description: 'List campaigns in the workspace with pagination.',
      parameters: {
        type: 'object',
        properties: {
          offset: { type: 'integer', description: 'Number of records to skip.' },
          limit: { type: 'integer', description: 'Maximum records to return.' },
        },
        required: ['offset', 'limit'],
      },
      request: {
        method: 'POST',
        path: '/campaign/GetAll',
        body: { offset: '{offset}', limit: '{limit}' },
      },
    },
    {
      name: 'list.list',
      class: 'read',
      description: 'List lead lists in the workspace with pagination.',
      parameters: {
        type: 'object',
        properties: {
          offset: { type: 'integer', description: 'Number of records to skip.' },
          limit: { type: 'integer', description: 'Maximum records to return.' },
        },
        required: ['offset', 'limit'],
      },
      request: {
        method: 'POST',
        path: '/list/GetAll',
        body: { offset: '{offset}', limit: '{limit}' },
      },
    },
    {
      name: 'lead.get',
      class: 'read',
      description: 'Get details for a lead by their LinkedIn profile URL.',
      parameters: {
        type: 'object',
        properties: {
          profileUrl: { type: 'string', description: 'LinkedIn profile URL of the lead.' },
        },
        required: ['profileUrl'],
      },
      request: {
        method: 'POST',
        path: '/lead/GetLead',
        body: { profileUrl: '{profileUrl}' },
      },
    },
    {
      name: 'campaign.add_leads',
      class: 'mutation',
      description: 'Add leads (LinkedIn profiles) to an active campaign, assigned to specific sender accounts.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'integer',
            description: 'Target campaign ID (must be ACTIVE or IN_PROGRESS).',
          },
          accountLeadPairs: {
            type: 'array',
            description: 'Array of pairs, each with an optional linkedInAccountId (sender) and a lead object (profileUrl, firstName, lastName, companyName, position, location, emailAddress).',
            items: { type: 'object' },
          },
        },
        required: ['campaignId', 'accountLeadPairs'],
      },
      request: {
        method: 'POST',
        path: '/campaign/AddLeadsToCampaignV2',
        body: { campaignId: '{campaignId}', accountLeadPairs: '{accountLeadPairs}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'inbox.get_conversations',
      class: 'read',
      description: 'Retrieve inbox conversations with filtering and pagination.',
      parameters: {
        type: 'object',
        properties: {
          offset: { type: 'integer', description: 'Number of records to skip.' },
          limit: { type: 'integer', description: 'Maximum records to return.' },
          filters: { type: 'object', description: 'Optional conversation filters.' },
        },
        required: ['offset', 'limit'],
      },
      request: {
        method: 'POST',
        path: '/inbox/GetConversationsV2',
        body: { offset: '{offset}', limit: '{limit}', filters: '{filters}' },
      },
    },
  ],
})
