import { declarativeRestConnector } from './declarative-rest.js'

// Zoho Desk uses OAuth2 for authentication and the Zoho-oauthtoken header prefix
// (similar to Zoho CRM). The API endpoint is region-aware; accounts.zoho.com is the
// default OAuth host. Like other Zoho services, region selection is handled via
// metadata returned from the token endpoint (api_domain).

const departmentParam = {
  type: 'string',
  description: 'Department id or name to list tickets from. Omit to list all departments.',
} as const

const statusFilterParam = {
  type: 'string',
  description: 'Ticket status: Open, OnHold, Closed, Spam.',
} as const

const ticketDataParam = {
  type: 'object',
  description: 'Ticket field object (subject, departmentId, contactId, description, etc.).',
} as const

export const zohoDeskConnector = declarativeRestConnector({
  kind: 'zoho-desk',
  displayName: 'Zoho Desk',
  description: 'List and search tickets, find contacts, and create or update Zoho Desk tickets.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: ['Desk.tickets.ALL', 'Desk.contacts.ALL', 'offline_access'],
    clientIdEnv: 'ZOHO_DESK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOHO_DESK_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://www.zohoapis.com' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Zoho-oauthtoken ' },
  test: { method: 'GET', path: '/desk/v1/tickets', query: { limit: '1' } },
  capabilities: [
    {
      name: 'tickets.list',
      class: 'read',
      description: 'List all tickets in a department with optional status filter and pagination.',
      parameters: {
        type: 'object',
        properties: {
          departmentId: departmentParam,
          status: statusFilterParam,
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/desk/v1/tickets',
        query: {
          departmentId: '{departmentId}',
          status: '{status}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      name: 'tickets.search',
      class: 'read',
      description: 'Search tickets by subject or description text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string.' },
          departmentId: departmentParam,
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/desk/v1/search/tickets',
        query: {
          query: '{query}',
          departmentId: '{departmentId}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      name: 'tickets.get',
      class: 'read',
      description: 'Get a ticket by id.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Ticket id.' },
        },
        required: ['ticketId'],
      },
      request: {
        method: 'GET',
        path: '/desk/v1/tickets/{ticketId}',
      },
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      name: 'tickets.create',
      class: 'mutation',
      description: 'Create a new ticket.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Ticket subject.' },
          departmentId: { type: 'string', description: 'Department id where the ticket will be created.' },
          contactId: { type: 'string', description: 'Contact id of the customer.' },
          description: { type: 'string', description: 'Ticket description.' },
          data: ticketDataParam,
        },
        required: ['subject', 'departmentId'],
      },
      request: {
        method: 'POST',
        path: '/desk/v1/tickets',
        body: '{data}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      name: 'tickets.update',
      class: 'mutation',
      description: 'Update an existing ticket by id.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Ticket id to update.' },
          data: { type: 'object', description: 'Fields to update (subject, status, description, etc.).' },
        },
        required: ['ticketId', 'data'],
      },
      request: {
        method: 'PATCH',
        path: '/desk/v1/tickets/{ticketId}',
        body: '{data}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      // Zoho Desk's PATCH /tickets/{id} with `status: "Closed"` is the canonical
      // close path; there is no dedicated /close endpoint. We surface it as a
      // distinct capability rather than nudging callers through tickets.update
      // because closure is a workflow-trigger boundary (SLA timers, satisfaction
      // surveys, escalations) and deserves its own audit trail.
      name: 'tickets.close',
      class: 'mutation',
      description: 'Close a ticket by setting its status to Closed. Triggers downstream SLA/notification automations.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Ticket id to close.' },
        },
        required: ['ticketId'],
      },
      request: {
        method: 'PATCH',
        path: '/desk/v1/tickets/{ticketId}',
        body: { status: 'Closed' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      // Assignment to an agent is also a PATCH against the ticket, with a
      // single `assigneeId` field. Zoho documents `assigneeId` on the ticket
      // PATCH body — assignment is not a separate route. We require the
      // assignee id because reassigning to "unassigned" is a different write
      // (set assigneeId: null) and we don't want to silently null on a missing
      // arg.
      name: 'tickets.assign',
      class: 'mutation',
      description: 'Assign a ticket to an agent by user id (uses the ticket PATCH route with assigneeId).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Ticket id to assign.' },
          assigneeId: { type: 'string', description: 'Agent user id to assign the ticket to.' },
        },
        required: ['ticketId', 'assigneeId'],
      },
      request: {
        method: 'PATCH',
        path: '/desk/v1/tickets/{ticketId}',
        body: { assigneeId: '{assigneeId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      // Comments are first-class resources under /tickets/{id}/comments.
      // `isPublic` controls whether the comment is visible to the requester or
      // internal-only; `contentType` lets the caller pick html/plainText. We
      // leave it on the caller rather than defaulting because Zoho's editor
      // produces both shapes and a silent default would change rendering.
      name: 'tickets.add-comment',
      class: 'mutation',
      description: 'Add a comment to a ticket. `isPublic` controls visibility (false = internal).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Ticket id to comment on.' },
          content: { type: 'string', description: 'Comment body.' },
          isPublic: { type: 'boolean', description: 'True for customer-visible, false for internal note.' },
          contentType: { type: 'string', enum: ['html', 'plainText'], description: 'Body format (defaults to plainText if omitted).' },
        },
        required: ['ticketId', 'content', 'isPublic'],
      },
      request: {
        // contentType is optional but the bare-placeholder body template
        // requires every key to resolve. body: 'args' lets us pass the
        // resolved arg bag (content + isPublic + optional contentType) without
        // tripping readRequiredPath on the optional field. Zoho silently
        // ignores extra `ticketId` in the body since it's already on the path.
        method: 'POST',
        path: '/desk/v1/tickets/{ticketId}/comments',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      // Merge consumes a primary ticket and a list of secondary ids. Zoho's
      // mergeTickets endpoint expects { ids: [...secondaries] } — the surviving
      // ticket id goes in the path. We keep the body shape verbatim instead of
      // aliasing to e.g. {tickets: [...]} so callers can match the Zoho docs
      // 1:1 when debugging merge failures.
      name: 'tickets.merge',
      class: 'mutation',
      description: 'Merge duplicate tickets into a single primary ticket. The primary id goes on the path; secondary ids in the body.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'Surviving (primary) ticket id.' },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Duplicate ticket ids to merge into the primary.',
            minItems: 1,
          },
        },
        required: ['ticketId', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/desk/v1/tickets/{ticketId}/mergeTickets',
        body: { ids: '{ids}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Desk.tickets.ALL'],
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Find a contact by email or search query.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email to search by.' },
          query: { type: 'string', description: 'Search query string.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/desk/v1/contacts',
        query: {
          email: '{email}',
          query: '{query}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['Desk.contacts.ALL'],
    },
  ],
})
