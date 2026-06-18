import { declarativeRestConnector } from './declarative-rest.js'

// Warmly — List identified website visitors and visiting accounts from your Warmly workspace via its agent-tools API.
// Auth: api-key. Base: https://opps-api.getwarmly.com/api. Docs: https://www.warmly.ai/launches/warmly-mcp-and-api-are-live
export const warmlyConnector = declarativeRestConnector({
  kind: 'warmly',
  displayName: 'Warmly',
  description: 'List identified website visitors and visiting accounts from your Warmly workspace via its agent-tools API.',
  auth: {
    kind: 'api-key',
    hint: 'Per-organization API key from the Warmly admin UI. Sent as the Authorization: Bearer header; organizationId must be included in each request body.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://opps-api.getwarmly.com/api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/agent-tools/tools' },
  capabilities: [
    {
      name: 'tools.list',
      class: 'read',
      description: 'Discover the available agent tools and their input JSON schemas for your workspace.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/agent-tools/tools' },
    },
    {
      name: 'visitors.list',
      class: 'mutation',
      description: 'List identified people who visited your website, with optional filters and pagination. This is a billed read executed via the tool-execution endpoint.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', description: 'The organization the API key is issued for.' },
          timeWindow: {
            type: 'string',
            description: 'Lookback window: past_day (default) or past_week.',
          },
          take: {
            type: 'integer',
            description: 'Number of results to return, 1-500 (default 25).',
          },
          offset: { type: 'integer', description: 'Pagination offset.' },
          searchTerm: { type: 'string', description: 'Substring match on name, email, or company.' },
        },
        required: ['organizationId'],
      },
      request: {
        method: 'POST',
        path: '/agent-tools/execute',
        body: {
          toolName: 'list_warm_visitors',
          organizationId: '{organizationId}',
          input: {
            timeWindow: '{timeWindow}',
            take: '{take}',
            offset: '{offset}',
            searchTerm: '{searchTerm}',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'accounts.list',
      class: 'mutation',
      description: 'List company-level aggregations of accounts that visited your website. Billed read executed via the tool-execution endpoint.',
      parameters: {
        type: 'object',
        properties: {
          organizationId: { type: 'string', description: 'The organization the API key is issued for.' },
          timeWindow: {
            type: 'string',
            description: 'Lookback window: past_day (default) or past_week.',
          },
          take: { type: 'integer', description: 'Number of results to return, 1-500.' },
        },
        required: ['organizationId'],
      },
      request: {
        method: 'POST',
        path: '/agent-tools/execute',
        body: {
          toolName: 'list_warm_accounts',
          organizationId: '{organizationId}',
          input: { timeWindow: '{timeWindow}', take: '{take}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
