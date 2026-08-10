import { declarativeRestConnector } from './declarative-rest.js'

const pagination = {
  page: { type: 'integer', minimum: 1 },
  perPage: { type: 'integer', minimum: 5, maximum: 50 },
}

const paginationQuery = { page: '{page}', per_page: '{perPage}' }

const zoneId = {
  zoneId: { type: 'string', minLength: 1, description: 'Cloudflare zone identifier.' },
}

const recordId = {
  recordId: { type: 'string', minLength: 1, description: 'Cloudflare DNS record identifier.' },
}

const recordFields = {
  type: {
    type: 'string',
    enum: [
      'A',
      'AAAA',
      'CAA',
      'CERT',
      'CNAME',
      'DNSKEY',
      'DS',
      'HTTPS',
      'LOC',
      'MX',
      'NAPTR',
      'NS',
      'OPENPGPKEY',
      'PTR',
      'SMIMEA',
      'SRV',
      'SSHFP',
      'SVCB',
      'TLSA',
      'TXT',
      'URI',
    ],
  },
  name: { type: 'string', minLength: 1, description: 'Complete DNS record name.' },
  content: { type: 'string', description: 'Provider-native record content.' },
  ttl: {
    type: 'integer',
    minimum: 1,
    maximum: 86400,
    description: 'TTL in seconds. Use 1 for automatic.',
  },
  proxied: { type: 'boolean' },
  priority: { type: 'integer' },
  comment: { type: ['string', 'null'] },
  tags: { type: 'array', items: { type: 'string' } },
  data: { type: 'object', description: 'Provider-native structured data for records such as SRV or CAA.' },
  settings: { type: 'object', description: 'Provider-native DNS record settings.' },
}

/**
 * Cloudflare — account, zone, and DNS administration through scoped API
 * tokens. Global API keys are deliberately unsupported because they grant the
 * full authority of a user and cannot be restricted to selected zones.
 */
export const cloudflareConnector = declarativeRestConnector({
  kind: 'cloudflare',
  displayName: 'Cloudflare',
  description: 'Inspect Cloudflare accounts and zones, then manage DNS records with a dedicated scoped API token.',
  auth: {
    kind: 'api-key',
    hint: 'Create a dedicated Cloudflare API token for Tangle Integration Hub. Grant Account Settings Read, Zone Read, Zone Settings Read, and DNS Read or DNS Edit only on selected resources. Never reuse a Tangle deployment, Workers, Terraform, or infrastructure token.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cloudflare.com/client/v4',
  credentialPlacement: { kind: 'bearer' },
  test: {
    method: 'GET',
    path: '/user/tokens/verify',
    expectResponse: [
      { path: 'success', equals: true },
      { path: 'result.status', equals: 'active' },
    ],
  },
  capabilities: [
    {
      name: 'auth.verify',
      class: 'read',
      description: 'Verify that the current API token is valid and active.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/user/tokens/verify' },
    },
    {
      name: 'accounts.get',
      class: 'read',
      description: 'Read one Cloudflare account and its settings.',
      parameters: {
        type: 'object',
        properties: { accountId: { type: 'string', minLength: 1 } },
        required: ['accountId'],
      },
      request: { method: 'GET', path: '/accounts/{accountId}' },
    },
    {
      name: 'zones.list',
      class: 'read',
      description: 'List or filter zones by account, domain, status, and type.',
      parameters: {
        type: 'object',
        properties: {
          ...pagination,
          accountId: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['initializing', 'pending', 'active', 'moved'] },
          type: { type: 'string', description: 'Comma-separated zone types.' },
          match: { type: 'string', enum: ['any', 'all'] },
          order: { type: 'string', enum: ['name', 'status', 'account.id', 'account.name', 'plan.id'] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      request: {
        method: 'GET',
        path: '/zones',
        query: {
          ...paginationQuery,
          'account.id': '{accountId}',
          name: '{name}',
          status: '{status}',
          type: '{type}',
          match: '{match}',
          order: '{order}',
          direction: '{direction}',
        },
      },
    },
    {
      name: 'zones.get',
      class: 'read',
      description: 'Read one zone with status, nameservers, plan, and ownership metadata.',
      parameters: { type: 'object', properties: zoneId, required: ['zoneId'] },
      request: { method: 'GET', path: '/zones/{zoneId}' },
    },
    {
      name: 'zones.settings.list',
      class: 'read',
      description: 'List all settings for one zone.',
      parameters: { type: 'object', properties: zoneId, required: ['zoneId'] },
      request: { method: 'GET', path: '/zones/{zoneId}/settings' },
    },
    {
      name: 'zones.settings.get',
      class: 'read',
      description: 'Read one setting for a zone.',
      parameters: {
        type: 'object',
        properties: {
          ...zoneId,
          settingId: { type: 'string', minLength: 1 },
        },
        required: ['zoneId', 'settingId'],
      },
      request: { method: 'GET', path: '/zones/{zoneId}/settings/{settingId}' },
    },
    {
      name: 'dns.records.list',
      class: 'read',
      description: 'List and filter DNS records in one zone.',
      parameters: {
        type: 'object',
        properties: {
          ...zoneId,
          ...pagination,
          type: { type: 'string' },
          name: { type: 'string', description: 'Exact record name.' },
          content: { type: 'string', description: 'Exact record content.' },
          proxied: { type: 'boolean' },
          match: { type: 'string', enum: ['any', 'all'] },
          order: { type: 'string', enum: ['type', 'name', 'content', 'ttl', 'proxied'] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['zoneId'],
      },
      request: {
        method: 'GET',
        path: '/zones/{zoneId}/dns_records',
        query: {
          ...paginationQuery,
          type: '{type}',
          'name.exact': '{name}',
          'content.exact': '{content}',
          proxied: '{proxied}',
          match: '{match}',
          order: '{order}',
          direction: '{direction}',
        },
      },
    },
    {
      name: 'dns.records.get',
      class: 'read',
      description: 'Read one DNS record by zone and record ID.',
      parameters: {
        type: 'object',
        properties: { ...zoneId, ...recordId },
        required: ['zoneId', 'recordId'],
      },
      request: { method: 'GET', path: '/zones/{zoneId}/dns_records/{recordId}' },
    },
    {
      name: 'dns.records.export',
      class: 'read',
      description: 'Export the current zone records as a BIND zone file before a change.',
      parameters: { type: 'object', properties: zoneId, required: ['zoneId'] },
      request: { method: 'GET', path: '/zones/{zoneId}/dns_records/export' },
    },
    {
      name: 'dns.records.create',
      class: 'mutation',
      description: 'Create one DNS record in a selected zone.',
      parameters: {
        type: 'object',
        properties: {
          ...zoneId,
          record: {
            type: 'object',
            properties: recordFields,
            required: ['type', 'name'],
            additionalProperties: false,
          },
        },
        required: ['zoneId', 'record'],
      },
      request: { method: 'POST', path: '/zones/{zoneId}/dns_records', body: '{record}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'dns.records.update',
      class: 'mutation',
      description: 'Partially update one DNS record.',
      parameters: {
        type: 'object',
        properties: {
          ...zoneId,
          ...recordId,
          changes: {
            type: 'object',
            properties: recordFields,
            additionalProperties: false,
          },
        },
        required: ['zoneId', 'recordId', 'changes'],
      },
      request: {
        method: 'PATCH',
        path: '/zones/{zoneId}/dns_records/{recordId}',
        body: '{changes}',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'dns.records.delete',
      class: 'mutation',
      description: 'Permanently delete one DNS record.',
      parameters: {
        type: 'object',
        properties: { ...zoneId, ...recordId },
        required: ['zoneId', 'recordId'],
      },
      request: { method: 'DELETE', path: '/zones/{zoneId}/dns_records/{recordId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
