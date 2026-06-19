import { declarativeRestConnector } from './declarative-rest.js'

// LaGrowthMachine — Multichannel sales automation (LinkedIn, email, Twitter). Create or update leads in audiences, list campaigns and audiences, and read campaign stats.
// Auth: api-key. Base: https://apiv2.lagrowthmachine.com. Docs: https://documenter.getpostman.com/view/2071164/TVCmSkH2
export const lagrowthmachineConnector = declarativeRestConnector({
  kind: 'lagrowthmachine',
  displayName: 'LaGrowthMachine',
  description: 'Multichannel sales automation (LinkedIn, email, Twitter). Create or update leads in audiences, list campaigns and audiences, and read campaign stats.',
  auth: {
    kind: 'api-key',
    hint: 'Get your API key at app.lagrowthmachine.com/settings/api. Sent as the \'apikey\' query parameter on every request.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://apiv2.lagrowthmachine.com',
  credentialPlacement: { kind: 'query', parameter: 'apikey' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/flow/audiences' },
  capabilities: [
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns with pagination.',
      parameters: {
        type: 'object',
        properties: {
          skip: { type: 'integer', description: 'Pagination offset.' },
          limit: { type: 'integer', description: 'Maximum results to return.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/flow/campaigns',
        query: { skip: '{skip}', limit: '{limit}' },
      },
    },
    {
      name: 'audiences.list',
      class: 'read',
      description: 'List the audiences in the workspace.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/flow/audiences' },
    },
    {
      name: 'campaign.get_stats',
      class: 'read',
      description: 'Get engagement statistics for a campaign.',
      parameters: {
        type: 'object',
        properties: { campaignId: { type: 'string', description: 'Campaign ID.' } },
        required: ['campaignId'],
      },
      request: { method: 'GET', path: '/flow/campaigns/{campaignId}/stats' },
    },
    {
      name: 'lead.create_or_update',
      class: 'mutation',
      description: 'Create or update a lead in an audience, which starts it through the audience\'s workflow.',
      parameters: {
        type: 'object',
        properties: {
          audience: { type: 'string', description: 'Audience name or identifier.' },
          proEmail: { type: 'string', description: 'Professional email.' },
          persoEmail: { type: 'string', description: 'Personal email.' },
          linkedinUrl: { type: 'string', description: 'LinkedIn profile URL.' },
          firstname: { type: 'string', description: 'First name.' },
          lastname: { type: 'string', description: 'Last name.' },
          companyName: { type: 'string', description: 'Company name.' },
          jobTitle: { type: 'string', description: 'Job title.' },
        },
        required: ['audience'],
      },
      request: {
        method: 'POST',
        path: '/flow/leads',
        body: {
          audience: '{audience}',
          proEmail: '{proEmail}',
          persoEmail: '{persoEmail}',
          linkedinUrl: '{linkedinUrl}',
          firstname: '{firstname}',
          lastname: '{lastname}',
          companyName: '{companyName}',
          jobTitle: '{jobTitle}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
