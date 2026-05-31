import { declarativeRestConnector } from './declarative-rest.js'

// Capsule CRM v2 REST API. OAuth2 authorization code flow against
// api.capsulecrm.com with the read/write scope pair Capsule documents at
// developer.capsulecrm.com. Write payloads use a single-entity envelope, e.g.
// `{ party: { ... } }`, so we surface that envelope on the action input.
//
// Capsule serves people, organisations, opportunities (deals), kases (cases),
// tasks and entries (notes/activities) from the same /api/v2 base; party is a
// polymorphic resource over person + organisation.

const embedParam = {
  type: 'string',
  description:
    'Comma-separated list of nested resources to embed in the response (e.g. fields,tags,missingImportantFields).',
} as const

const perPageParam = {
  type: 'integer',
  minimum: 1,
  maximum: 100,
  description: 'Page size. Capsule caps at 100 per page.',
} as const

const pageParam = {
  type: 'integer',
  minimum: 1,
  description: 'One-based page number.',
} as const

export const capsuleCrmConnector = declarativeRestConnector({
  kind: 'capsule-crm',
  displayName: 'Capsule CRM',
  description:
    'Manage Capsule CRM v2: search and write parties (people/organisations), opportunities, kases (cases), tasks, and entries (notes/activities).',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.capsulecrm.com/oauth/authorise',
    tokenUrl: 'https://api.capsulecrm.com/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'CAPSULE_CRM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CAPSULE_CRM_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.capsulecrm.com/api/v2',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'parties.search',
      class: 'read',
      description:
        'Search parties (people and organisations) by free-text query, email, or tag. Returns up to 100 per page.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Free-text search term.' },
          email: { type: 'string' },
          tag: { type: 'string' },
          embed: embedParam,
          page: pageParam,
          perPage: perPageParam,
        },
      },
      request: {
        method: 'GET',
        path: '/parties/search',
        query: {
          q: '{q}',
          email: '{email}',
          tag: '{tag}',
          embed: '{embed}',
          page: '{page}',
          perPage: '{perPage}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'parties.get',
      class: 'read',
      description: 'Fetch a single party (person or organisation) by id.',
      parameters: {
        type: 'object',
        properties: {
          partyId: { type: 'string' },
          embed: embedParam,
        },
        required: ['partyId'],
      },
      request: {
        method: 'GET',
        path: '/parties/{partyId}',
        query: { embed: '{embed}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'parties.create',
      class: 'mutation',
      description:
        'Create a party. The `party` body envelope must specify `type: "person"` or `type: "organisation"`.',
      parameters: {
        type: 'object',
        properties: {
          party: {
            type: 'object',
            description:
              'Capsule party envelope (firstName/lastName for person, name for organisation, plus emailAddresses, phoneNumbers, addresses, etc.).',
          },
        },
        required: ['party'],
      },
      request: { method: 'POST', path: '/parties', body: { party: '{party}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'parties.update',
      class: 'mutation',
      description: 'Update a party by id. Only the fields present in `party` are modified.',
      parameters: {
        type: 'object',
        properties: {
          partyId: { type: 'string' },
          party: { type: 'object' },
        },
        required: ['partyId', 'party'],
      },
      request: {
        method: 'PUT',
        path: '/parties/{partyId}',
        body: { party: '{party}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'opportunities.search',
      class: 'read',
      description: 'Search opportunities (deals) by free-text query, milestone, or party.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          milestone: { type: 'string', description: 'Milestone id.' },
          party: { type: 'string', description: 'Party id of the linked party.' },
          embed: embedParam,
          page: pageParam,
          perPage: perPageParam,
        },
      },
      request: {
        method: 'GET',
        path: '/opportunities/search',
        query: {
          q: '{q}',
          milestone: '{milestone}',
          party: '{party}',
          embed: '{embed}',
          page: '{page}',
          perPage: '{perPage}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'opportunities.create',
      class: 'mutation',
      description:
        'Create an opportunity. The envelope must include `party.id` (linked party) and `milestone.id`.',
      parameters: {
        type: 'object',
        properties: {
          opportunity: {
            type: 'object',
            description:
              'Capsule opportunity envelope (name, description, party {id}, milestone {id}, value {amount, currency}, expectedCloseOn, probability).',
          },
        },
        required: ['opportunity'],
      },
      request: {
        method: 'POST',
        path: '/opportunities',
        body: { opportunity: '{opportunity}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'opportunities.update',
      class: 'mutation',
      description: 'Update an opportunity by id (move milestone, change value, edit description, etc.).',
      parameters: {
        type: 'object',
        properties: {
          opportunityId: { type: 'string' },
          opportunity: { type: 'object' },
        },
        required: ['opportunityId', 'opportunity'],
      },
      request: {
        method: 'PUT',
        path: '/opportunities/{opportunityId}',
        body: { opportunity: '{opportunity}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'kases.search',
      class: 'read',
      description: 'Search kases (cases) by free-text query, status, or party.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
          party: { type: 'string' },
          embed: embedParam,
          page: pageParam,
          perPage: perPageParam,
        },
      },
      request: {
        method: 'GET',
        path: '/kases/search',
        query: {
          q: '{q}',
          status: '{status}',
          party: '{party}',
          embed: '{embed}',
          page: '{page}',
          perPage: '{perPage}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'kases.create',
      class: 'mutation',
      description: 'Create a kase (case). The envelope must include `party.id`.',
      parameters: {
        type: 'object',
        properties: {
          kase: {
            type: 'object',
            description:
              'Capsule kase envelope (name, description, party {id}, status, owner {id}, expectedCloseOn).',
          },
        },
        required: ['kase'],
      },
      request: { method: 'POST', path: '/kases', body: { kase: '{kase}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'kases.update',
      class: 'mutation',
      description: 'Update a kase by id.',
      parameters: {
        type: 'object',
        properties: {
          kaseId: { type: 'string' },
          kase: { type: 'object' },
        },
        required: ['kaseId', 'kase'],
      },
      request: { method: 'PUT', path: '/kases/{kaseId}', body: { kase: '{kase}' } },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List tasks, optionally filtered by status or owner.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['OPEN', 'COMPLETED', 'PENDING'] },
          owner: { type: 'string', description: 'User id of the task owner.' },
          embed: embedParam,
          page: pageParam,
          perPage: perPageParam,
        },
      },
      request: {
        method: 'GET',
        path: '/tasks',
        query: {
          status: '{status}',
          owner: '{owner}',
          embed: '{embed}',
          page: '{page}',
          perPage: '{perPage}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task. May be linked to a party, opportunity, or kase via the envelope.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'object',
            description:
              'Capsule task envelope (description, detail, dueOn, dueTime, category {id}, owner {id}, party {id}?, opportunity {id}?, kase {id}?).',
          },
        },
        required: ['task'],
      },
      request: { method: 'POST', path: '/tasks', body: { task: '{task}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update a task by id (reassign, change due date, mark completed, etc.).',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          task: { type: 'object' },
        },
        required: ['taskId', 'task'],
      },
      request: { method: 'PUT', path: '/tasks/{taskId}', body: { task: '{task}' } },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'entries.create',
      class: 'mutation',
      description:
        'Create an entry (note or activity) against a party, opportunity, or kase. The envelope `type` must be `note` for free-text notes.',
      parameters: {
        type: 'object',
        properties: {
          entry: {
            type: 'object',
            description:
              'Capsule entry envelope (type: "note", content, party {id}? / opportunity {id}? / kase {id}?, activityType {id}?).',
          },
        },
        required: ['entry'],
      },
      request: { method: 'POST', path: '/entries', body: { entry: '{entry}' } },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List Capsule users in the account (for owner assignment lookups).',
      parameters: {
        type: 'object',
        properties: {
          page: pageParam,
          perPage: perPageParam,
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { page: '{page}', perPage: '{perPage}' },
      },
      requiredScopes: ['read'],
    },
  ],
})
