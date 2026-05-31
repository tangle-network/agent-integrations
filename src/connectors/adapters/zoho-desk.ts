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
