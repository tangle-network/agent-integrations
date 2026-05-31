import { declarativeRestConnector } from './declarative-rest.js'

// Customer.io App API: Bearer-token REST surface for campaign, segment, customer,
// and transactional-send operations. Track API (Basic site_id:track_api_key) is a
// separate surface and is intentionally NOT modeled here — agents that need
// identify/event ingest should use the Track API connector directly.
//
// Region selection is per-workspace: US workspaces use api.customer.io, EU
// workspaces use api-eu.customer.io. The connection stores its region in
// metadata.region (or metadata.baseUrl for hosts that pre-resolve the URL).

const customerIdentifiers = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    cio_id: { type: 'string' },
  },
}

const transactionalMessage = {
  type: 'object',
  properties: {
    transactional_message_id: { type: ['string', 'integer'] },
    to: { type: 'string' },
    identifiers: customerIdentifiers,
    from: { type: 'string' },
    reply_to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    plaintext_body: { type: 'string' },
    preheader: { type: 'string' },
    fake_bcc: { type: 'boolean' },
    disable_message_retention: { type: 'boolean' },
    send_to_unsubscribed: { type: 'boolean' },
    tracked: { type: 'boolean' },
    queue_draft: { type: 'boolean' },
    message_data: { type: 'object' },
    headers: { type: 'object' },
    attachments: { type: 'object' },
  },
  required: ['identifiers'],
}

export const customerIoConnector = declarativeRestConnector({
  kind: 'customer-io',
  displayName: 'Customer.io',
  description: 'Trigger Customer.io campaigns, send transactional email, and read customers / segments / messages through the App API (Bearer).',
  auth: {
    kind: 'api-key',
    hint: 'Customer.io App API key (Workspace Settings → API Credentials → App API Keys). For EU workspaces also set metadata.region="eu".',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.customer.io' },
  test: { method: 'GET', path: '/v1/api/info/ip_addresses' },
  capabilities: [
    {
      name: 'customers.search',
      class: 'read',
      description: 'Search customers by attribute filter (App API customer search).',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'object', description: 'Customer.io filter expression (e.g. { and: [{ attribute: { field: "email", operator: "eq", value: "ada@example.com" } }] }).' },
          start: { type: 'string', description: 'Pagination cursor returned by previous response.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        required: ['filter'],
      },
      request: {
        method: 'POST',
        path: '/v1/customers',
        query: { start: '{start}', limit: '{limit}' },
        body: { filter: '{filter}' },
      },
    },
    {
      name: 'customers.get',
      class: 'read',
      description: 'Read a single customer profile and its tracked attributes by ID.',
      parameters: {
        type: 'object',
        properties: { customerId: { type: 'string' } },
        required: ['customerId'],
      },
      request: { method: 'GET', path: '/v1/customers/{customerId}/attributes' },
    },
    {
      name: 'customers.segments',
      class: 'read',
      description: 'List the segments a customer belongs to.',
      parameters: {
        type: 'object',
        properties: { customerId: { type: 'string' } },
        required: ['customerId'],
      },
      request: { method: 'GET', path: '/v1/customers/{customerId}/segments' },
    },
    {
      name: 'segments.search',
      class: 'read',
      description: 'List all segments in the workspace.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/segments' },
    },
    {
      name: 'segments.get',
      class: 'read',
      description: 'Read a single segment definition.',
      parameters: {
        type: 'object',
        properties: { segmentId: { type: 'integer' } },
        required: ['segmentId'],
      },
      request: { method: 'GET', path: '/v1/segments/{segmentId}' },
    },
    {
      name: 'campaigns.search',
      class: 'read',
      description: 'List campaigns (newsletters and triggered) defined in the workspace.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/campaigns' },
    },
    {
      name: 'campaigns.get',
      class: 'read',
      description: 'Read a single campaign by ID.',
      parameters: {
        type: 'object',
        properties: { campaignId: { type: 'integer' } },
        required: ['campaignId'],
      },
      request: { method: 'GET', path: '/v1/campaigns/{campaignId}' },
    },
    {
      name: 'messages.search',
      class: 'read',
      description: 'List sent messages (delivery records) with optional filters.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          type: { type: 'string', enum: ['email', 'push', 'sms', 'webhook', 'slack', 'in_app'] },
          metric: { type: 'string', enum: ['delivered', 'sent', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed', 'spammed'] },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/messages',
        query: { start: '{start}', limit: '{limit}', type: '{type}', metric: '{metric}' },
      },
    },
    {
      name: 'campaigns.trigger',
      class: 'mutation',
      description: 'Trigger an API-triggered broadcast campaign for a set of recipients or segments.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'integer' },
          ids: { type: 'array', items: { type: 'string' }, description: 'Customer IDs to target.' },
          emails: { type: 'array', items: { type: 'string' } },
          per_user_data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                data: { type: 'object' },
              },
              required: ['id'],
            },
          },
          data_file_url: { type: 'string', description: 'CSV/URL data file for high-volume broadcasts.' },
          data: { type: 'object', description: 'Shared trigger data merged into the campaign template.' },
          recipients: { type: 'object', description: 'Segment-targeting filter (mutually exclusive with ids/emails).' },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'POST',
        path: '/v1/campaigns/{campaignId}/triggers',
        // `campaignId` is consumed by the path interpolator; the broadcast trigger
        // payload is everything else on `args` (Customer.io ignores unknown keys).
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transactional.send-email',
      class: 'mutation',
      description: 'Send a transactional email via /v1/send/email (uses a configured transactional message template).',
      parameters: {
        type: 'object',
        properties: {
          message: transactionalMessage,
        },
        required: ['message'],
      },
      request: { method: 'POST', path: '/v1/send/email', body: '{message}' },
      cas: 'native-idempotency',
    },
    {
      name: 'segments.add-customers',
      class: 'mutation',
      description: 'Add customers to a manual segment.',
      parameters: {
        type: 'object',
        properties: {
          segmentId: { type: 'integer' },
          ids: { type: 'array', items: { type: 'string' } },
          id_type: { type: 'string', enum: ['id', 'email', 'cio_id'] },
        },
        required: ['segmentId', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/v1/segments/{segmentId}/add_customers',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'segments.remove-customers',
      class: 'mutation',
      description: 'Remove customers from a manual segment.',
      parameters: {
        type: 'object',
        properties: {
          segmentId: { type: 'integer' },
          ids: { type: 'array', items: { type: 'string' } },
          id_type: { type: 'string', enum: ['id', 'email', 'cio_id'] },
        },
        required: ['segmentId', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/v1/segments/{segmentId}/remove_customers',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
  ],
})
