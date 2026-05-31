import { declarativeRestConnector } from './declarative-rest.js'

// Freshservice REST API is scoped to a per-tenant subdomain
// (https://{subdomain}.freshservice.com/api/v2). The orchestrator stores
// the resolved host under connection metadata key `domainUrl` so the
// executor can substitute it at call time. Auth is a per-tenant API key
// (Basic auth: <api_key>:X, per Freshservice docs); the declarative-rest
// runtime handles the api-key header binding.
//
// Docs: https://api.freshservice.com/
// Activepieces source: packages/pieces/community/freshservice

export const freshserviceConnector = declarativeRestConnector({
  kind: 'freshservice',
  displayName: 'Freshservice',
  description:
    'Create and update Freshservice tickets, requesters, ticket notes, and approval requests.',
  auth: {
    kind: 'api-key',
    hint: 'Freshservice API key from Profile Settings, combined with the per-tenant subdomain (e.g. `mycompany`). Sent as HTTP Basic `Authorization: Basic base64(<api_key>:X)`.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'domainUrl' },
  test: { method: 'GET', path: '/api/v2/tickets', query: { per_page: '1' } },
  capabilities: [
    {
      name: 'tickets.list',
      class: 'read',
      description:
        'List Freshservice tickets, optionally filtered by predefined filter (new_and_my_open, watching, spam, deleted), requester, or updated_since timestamp.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['new_and_my_open', 'watching', 'spam', 'deleted'] },
          requester_id: { type: 'integer' },
          email: { type: 'string' },
          updated_since: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/tickets',
        query: {
          filter: '{filter}',
          requester_id: '{requester_id}',
          email: '{email}',
          updated_since: '{updated_since}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'tickets.get',
      class: 'read',
      description:
        'Read a single Freshservice ticket by id with optional `include` expansions (conversations, requester, requested_for, stats, problem, assets, change, related_tickets).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          include: { type: 'string' },
        },
        required: ['ticketId'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/tickets/{ticketId}',
        query: { include: '{include}' },
      },
    },
    {
      name: 'requesters.list',
      class: 'read',
      description:
        'List Freshservice requesters, optionally filtered by email, mobile_phone_number, work_phone_number, or include_agents.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          mobile_phone_number: { type: 'string' },
          work_phone_number: { type: 'string' },
          include_agents: { type: 'boolean' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/requesters',
        query: {
          email: '{email}',
          mobile_phone_number: '{mobile_phone_number}',
          work_phone_number: '{work_phone_number}',
          include_agents: '{include_agents}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'tickets.create',
      class: 'mutation',
      description:
        'Create a Freshservice ticket. Maps to the activepieces `createTicket` action. Requires `subject`, `description`, and a requester identifier (email, requester_id, phone, or twitter_id). Optional fields drive triage (type, status, priority, category, sub_category, tags, custom_fields).',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          email: { type: 'string' },
          requester_id: { type: 'integer' },
          phone: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'integer', minimum: 2, maximum: 5 },
          priority: { type: 'integer', minimum: 1, maximum: 4 },
          source: { type: 'integer' },
          type: { type: 'string' },
          category: { type: 'string' },
          sub_category: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          cc_emails: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
          group_id: { type: 'integer' },
          responder_id: { type: 'integer' },
          department_id: { type: 'integer' },
          urgency: { type: 'integer', minimum: 1, maximum: 3 },
          impact: { type: 'integer', minimum: 1, maximum: 3 },
        },
        required: ['subject', 'description'],
      },
      request: { method: 'POST', path: '/api/v2/tickets', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'tickets.note',
      class: 'mutation',
      description:
        'Add a note to a Freshservice ticket. Maps to the activepieces `addNoteToTicket` action. Set `private: true` to make the note agent-only; otherwise the requester can see it. Body supports HTML.',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          body: { type: 'string' },
          private: { type: 'boolean' },
          incoming: { type: 'boolean' },
          user_id: { type: 'integer' },
          notify_emails: { type: 'array', items: { type: 'string' } },
        },
        required: ['ticketId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/tickets/{ticketId}/notes',
        body: {
          body: '{body}',
          private: '{private}',
          incoming: '{incoming}',
          user_id: '{user_id}',
          notify_emails: '{notify_emails}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'requesters.create',
      class: 'mutation',
      description:
        'Create a Freshservice requester. Maps to the activepieces `createRequester` action. Requires `first_name` and `primary_email`. Optional contact, job, and custom fields are passed through.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          primary_email: { type: 'string' },
          last_name: { type: 'string' },
          job_title: { type: 'string' },
          phone: { type: 'string' },
          mobile_phone_number: { type: 'string' },
          work_phone_number: { type: 'string' },
          department_ids: { type: 'array', items: { type: 'integer' } },
          location_id: { type: 'integer' },
          time_zone: { type: 'string' },
          language: { type: 'string' },
          background_information: { type: 'string' },
          address: { type: 'string' },
          secondary_emails: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
        },
        required: ['first_name', 'primary_email'],
      },
      request: { method: 'POST', path: '/api/v2/requesters', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'tickets.requestApproval',
      class: 'mutation',
      description:
        'Request approval for a Freshservice ticket. Maps to the activepieces `requestTicketApproval` action. `approval_type` selects how multiple approvers are resolved (e.g. `anyone` / `everyone`).',
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          approver_ids: { type: 'array', items: { type: 'integer' } },
          approval_type: { type: 'string' },
          email_content: { type: 'string' },
        },
        required: ['ticketId', 'approver_ids'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/tickets/{ticketId}/approvals',
        body: {
          approver_ids: '{approver_ids}',
          approval_type: '{approval_type}',
          email_content: '{email_content}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
