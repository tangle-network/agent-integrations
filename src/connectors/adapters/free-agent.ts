import { declarativeRestConnector } from './declarative-rest.js'

// FreeAgent is a UK-focused accounting/invoicing SaaS for small businesses. The
// v2 REST API is contact-centric: projects (and the tasks under them) hang off
// a contact, and invoices reference a contact URL. Resource identifiers are
// returned as URLs (e.g. `https://api.freeagent.com/v2/contacts/123`) and that
// same URL is the value clients pass back when nesting one resource under
// another, which is why mutation payloads carry full URL strings rather than
// bare ids. The activepieces piece exposes "create task" / "create contact"
// actions plus polling triggers for new-invoice/new-contact/new-user/new-task;
// we mirror those as capabilities and add the obvious read counterparts so the
// adapter is usable end-to-end without forcing callers to round-trip out of
// band.
export const freeAgentConnector = declarativeRestConnector({
  kind: 'free-agent',
  displayName: 'FreeAgent',
  description: 'Accounting and invoicing software for small businesses — contacts, projects, tasks, invoices, and users.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.freeagent.com/v2/approve_app',
    tokenUrl: 'https://api.freeagent.com/v2/token_endpoint',
    scopes: [],
    clientIdEnv: 'FREE_AGENT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FREE_AGENT_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.freeagent.com/v2',
  test: { method: 'GET', path: '/company' },
  capabilities: [
    {
      name: 'contacts.search',
      class: 'read',
      description: 'List or search FreeAgent contacts.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', description: 'Filter by view (e.g. "active", "clients", "suppliers", "all").' },
          sort: { type: 'string', description: 'Sort field (e.g. "name", "updated_at", "-created_at").' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { view: '{view}', sort: '{sort}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Get a single FreeAgent contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/contacts/{contactId}' },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a FreeAgent contact (client or supplier).',
      parameters: {
        type: 'object',
        properties: {
          contact: {
            type: 'object',
            description: 'FreeAgent contact attributes (organisation_name, first_name, last_name, email, address1, town, postcode, country, etc.).',
          },
        },
        required: ['contact'],
      },
      request: { method: 'POST', path: '/contacts', body: { contact: '{contact}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update fields on an existing FreeAgent contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          contact: { type: 'object' },
        },
        required: ['contactId', 'contact'],
      },
      request: { method: 'PUT', path: '/contacts/{contactId}', body: { contact: '{contact}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description:
        'Delete a FreeAgent contact by id. Destructive; not idempotent after success on the same id.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'FreeAgent contact id.' },
        },
        required: ['contactId'],
      },
      request: { method: 'DELETE', path: '/contacts/{contactId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'projects.search',
      class: 'read',
      description: 'List or filter FreeAgent projects.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', description: 'Filter by view (e.g. "active", "completed", "all").' },
          contact: { type: 'string', description: 'Restrict to a contact URL.' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/projects',
        query: { view: '{view}', contact: '{contact}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'tasks.search',
      class: 'read',
      description: 'List tasks, optionally scoped to a project.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project URL to restrict tasks to.' },
          view: { type: 'string', description: 'Task view filter (e.g. "active", "completed", "all").' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/tasks',
        query: { project: '{project}', view: '{view}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Get a single FreeAgent task by id.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      request: { method: 'GET', path: '/tasks/{taskId}' },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task under a FreeAgent project (mirrors the activepieces "Free Agent Create Task" action).',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'object',
            description: 'Task attributes (project URL, name, is_billable, billing_rate, billing_period, status, etc.).',
          },
        },
        required: ['task'],
      },
      request: { method: 'POST', path: '/tasks', body: { task: '{task}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update an existing FreeAgent task.',
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
    },
    {
      name: 'invoices.search',
      class: 'read',
      description: 'List or filter FreeAgent invoices (used to back the new-invoice polling trigger).',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', description: 'Invoice view (e.g. "open", "draft", "scheduled_to_email", "all").' },
          contact: { type: 'string', description: 'Contact URL filter.' },
          project: { type: 'string', description: 'Project URL filter.' },
          updated_since: { type: 'string', description: 'ISO-8601 timestamp; returns invoices updated on or after this moment.' },
          sort: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/invoices',
        query: {
          view: '{view}',
          contact: '{contact}',
          project: '{project}',
          updated_since: '{updated_since}',
          sort: '{sort}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'invoices.get',
      class: 'read',
      description: 'Get a single FreeAgent invoice by id.',
      parameters: {
        type: 'object',
        properties: { invoiceId: { type: 'string' } },
        required: ['invoiceId'],
      },
      request: { method: 'GET', path: '/invoices/{invoiceId}' },
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description:
        'Create a FreeAgent invoice. `invoice` accepts the FreeAgent invoice payload (contact URL, dated_on, payment_terms_in_days, invoice_items, etc.).',
      parameters: {
        type: 'object',
        properties: {
          invoice: {
            type: 'object',
            description:
              'FreeAgent invoice attributes — `contact` URL is required; `dated_on`, `payment_terms_in_days`, `invoice_items`, `currency`, and `comments` are typical fields.',
          },
        },
        required: ['invoice'],
      },
      request: { method: 'POST', path: '/invoices', body: { invoice: '{invoice}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'invoices.send',
      class: 'mutation',
      description:
        'Send a FreeAgent invoice to the contact via email. Maps to the `send_email` action on an existing invoice; `email` overrides the contact default recipient list when provided.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'FreeAgent invoice id to send.' },
          email: {
            type: 'object',
            description:
              'Email override — accepts `recipient`, `subject`, `body`, `send_me_a_copy` per the FreeAgent send_email schema.',
          },
        },
        required: ['invoiceId'],
      },
      request: {
        method: 'POST',
        path: '/invoices/{invoiceId}/send_email',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.search',
      class: 'read',
      description: 'List FreeAgent users on the company (backs the new-user polling trigger).',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', description: 'User view filter (e.g. "all", "active").' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { view: '{view}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Get a single FreeAgent user by id.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/users/{userId}' },
    },
  ],
})
