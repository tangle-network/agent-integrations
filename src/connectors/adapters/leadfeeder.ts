import { declarativeRestConnector } from './declarative-rest.js'

// Leadfeeder — Identify the company behind a website-visitor IP address, returning firmographic details and a confidence score.
// Auth: api-key. Base: https://api.lf-discover.com. Docs: https://docs.leadfeeder.com/connectors/ip-enrich-api/
export const leadfeederConnector = declarativeRestConnector({
  kind: 'leadfeeder',
  displayName: 'Leadfeeder',
  description: 'Identify the company behind a website-visitor IP address, returning firmographic details and a confidence score.',
  auth: {
    kind: 'api-key',
    hint: 'API key from Leadfeeder (Dealfront) Settings -> API keys. Sent in the X-API-KEY request header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.lf-discover.com',
  credentialPlacement: { kind: 'header', header: 'X-API-KEY' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/companies', query: { ip: '185.70.216.139' } },
  capabilities: [
    {
      name: 'ip.enrich',
      class: 'read',
      description: 'Resolve an IPv4 or IPv6 address to the company that owns it, including name, domain, industry, size, revenue, location, and confidence.',
      parameters: {
        type: 'object',
        properties: {
          ip: {
            type: 'string',
            description: 'Valid IPv4 or shortened IPv6 address to enrich, e.g. 185.70.216.139.',
          },
        },
        required: ['ip'],
      },
      request: { method: 'GET', path: '/companies', query: { ip: '{ip}' } },
    },
  ],
})
