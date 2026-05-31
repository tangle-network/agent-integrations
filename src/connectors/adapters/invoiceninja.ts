import { declarativeRestConnector } from './declarative-rest.js'

// Invoice Ninja is self-hostable as well as offered at app.invoicing.co — the
// per-connection `baseUrl` metadata key holds the chosen host root
// (e.g. https://invoicing.co or https://invoices.example.com). The API token
// is sent in the X-API-TOKEN header per the v1 docs.
export const invoiceninjaConnector = declarativeRestConnector({
  kind: 'invoiceninja',
  displayName: 'Invoice Ninja',
  description:
    'Manage Invoice Ninja clients, invoices, recurring invoices, tasks, and reports for billing and accounting workflows.',
  auth: {
    kind: 'api-key',
    hint: 'Invoice Ninja API token from Settings → Account Management → API Tokens. The connection must also store the instance baseUrl (e.g. https://invoicing.co).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://invoicing.co' },
  credentialPlacement: { kind: 'header', header: 'X-API-TOKEN' },
  defaultHeaders: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  test: { method: 'GET', path: '/api/v1/ping' },
  capabilities: [
    {
      name: 'clients.create',
      class: 'mutation',
      description: 'Create a client (organization or natural person) in Invoice Ninja.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Business name or natural-person name.' },
          vat_number: { type: 'string', description: 'Tax/VAT number; leave blank if N/A.' },
          private_notes: { type: 'string' },
          address1: { type: 'string' },
          address2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postal_code: { type: 'string' },
          country_id: { type: 'string' },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                send_email: { type: 'boolean' },
              },
              required: ['email'],
            },
          },
        },
        required: ['name', 'contacts'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/clients',
        body: {
          name: '{name}',
          vat_number: '{vat_number}',
          private_notes: '{private_notes}',
          address1: '{address1}',
          address2: '{address2}',
          city: '{city}',
          state: '{state}',
          postal_code: '{postal_code}',
          country_id: '{country_id}',
          contacts: '{contacts}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'clients.get',
      class: 'read',
      description: 'Look up a client by email (returns the matching client record).',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Client contact email to search.' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/clients',
        query: { email: '{email}' },
      },
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description: 'Create an invoice for a client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string', description: 'Invoice Ninja client id.' },
          po_number: { type: 'string', description: 'Purchase order number (optional).' },
          discount: { type: 'number' },
          is_amount_discount: {
            type: 'boolean',
            description: 'true = discount is an amount, false = percentage.',
          },
          public_notes: { type: 'string' },
          private_notes: { type: 'string' },
          due_date: { type: 'string', description: 'Due date in YYYY-MM-DD.' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                product_key: { type: 'string' },
                notes: { type: 'string' },
                cost: { type: 'number' },
                quantity: { type: 'number' },
                tax_name1: { type: 'string' },
                tax_rate1: { type: 'number' },
              },
              required: ['notes', 'cost', 'quantity'],
            },
          },
          email_invoice: {
            type: 'boolean',
            description: 'Send the invoice to the client by email on creation.',
          },
          mark_sent: { type: 'boolean', description: 'Mark the invoice as sent.' },
        },
        required: ['client_id', 'line_items'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/invoices',
        query: {
          email_invoice: '{email_invoice}',
          mark_sent: '{mark_sent}',
        },
        body: {
          client_id: '{client_id}',
          po_number: '{po_number}',
          discount: '{discount}',
          is_amount_discount: '{is_amount_discount}',
          public_notes: '{public_notes}',
          private_notes: '{private_notes}',
          due_date: '{due_date}',
          line_items: '{line_items}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invoices.list',
      class: 'read',
      description: 'List or filter invoices by status and/or client.',
      parameters: {
        type: 'object',
        properties: {
          client_status: {
            type: 'string',
            description:
              'Comma-separated list of statuses: draft, sent, viewed, approved, partial, paid, overdue.',
          },
          client_id: { type: 'string' },
          per_page: { type: 'integer', minimum: 1, maximum: 9999 },
        },
        required: ['client_status'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/invoices',
        query: {
          client_status: '{client_status}',
          client_id: '{client_id}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'recurring_invoices.create',
      class: 'mutation',
      description: 'Create a recurring invoice for a client.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'string' },
          frequency_id: {
            type: 'integer',
            description:
              'Frequency: 1 daily, 2 weekly, 3 two-weeks, 4 four-weeks, 5 monthly, 6 two-months, 7 three-months, 8 four-months, 9 six-months, 10 annually, 11 two-years, 12 three-years.',
          },
          remaining_cycles: {
            type: 'integer',
            description: 'How many cycles remain; -1 = indefinite.',
          },
          next_send_date: { type: 'string', description: 'Next send date in YYYY-MM-DD.' },
          discount: { type: 'number' },
          is_amount_discount: { type: 'boolean' },
          public_notes: { type: 'string' },
          private_notes: { type: 'string' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                product_key: { type: 'string' },
                notes: { type: 'string' },
                cost: { type: 'number' },
                quantity: { type: 'number' },
              },
              required: ['notes', 'cost', 'quantity'],
            },
          },
        },
        required: ['client_id', 'frequency_id', 'line_items'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/recurring_invoices',
        body: {
          client_id: '{client_id}',
          frequency_id: '{frequency_id}',
          remaining_cycles: '{remaining_cycles}',
          next_send_date: '{next_send_date}',
          discount: '{discount}',
          is_amount_discount: '{is_amount_discount}',
          public_notes: '{public_notes}',
          private_notes: '{private_notes}',
          line_items: '{line_items}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'recurring_invoices.action',
      class: 'mutation',
      description:
        'Perform an action on a recurring invoice (start, stop, send_now, restore, archive, delete).',
      parameters: {
        type: 'object',
        properties: {
          recurring_id: { type: 'string', description: 'Recurring invoice id.' },
          action: {
            type: 'string',
            enum: ['start', 'stop', 'send_now', 'restore', 'archive', 'delete'],
          },
        },
        required: ['recurring_id', 'action'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/recurring_invoices/bulk',
        body: {
          action: '{action}',
          ids: ['{recurring_id}'],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a billable task entry against a client (and optionally a project).',
      parameters: {
        type: 'object',
        properties: {
          number: {
            type: 'string',
            description: 'Unique task or ticket number not previously used.',
          },
          client_id: { type: 'string' },
          project_id: { type: 'string' },
          description: { type: 'string' },
          rate: { type: 'number', description: 'Custom hourly rate (optional).' },
          time_log: {
            type: 'string',
            description: 'JSON-encoded time-log array, e.g. [[start_epoch, end_epoch]].',
          },
        },
        required: ['number', 'client_id', 'description'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/tasks',
        body: {
          number: '{number}',
          client_id: '{client_id}',
          project_id: '{project_id}',
          description: '{description}',
          rate: '{rate}',
          time_log: '{time_log}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.exists',
      class: 'read',
      description: 'Check whether a task with the given number already exists.',
      parameters: {
        type: 'object',
        properties: {
          number: { type: 'string' },
        },
        required: ['number'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/tasks',
        query: { number: '{number}' },
      },
    },
    {
      name: 'reports.get',
      class: 'read',
      description: 'Generate a report (clients, invoices, payments, profit_and_loss, tax_summary).',
      parameters: {
        type: 'object',
        properties: {
          report_type: {
            type: 'string',
            enum: [
              'clients',
              'invoices',
              'payments',
              'profit_and_loss',
              'tax_summary',
              'aged_receivables',
            ],
          },
          start_date: { type: 'string', description: 'YYYY-MM-DD.' },
          end_date: { type: 'string', description: 'YYYY-MM-DD.' },
          client_id: { type: 'string' },
        },
        required: ['report_type'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/reports/{report_type}',
        body: {
          start_date: '{start_date}',
          end_date: '{end_date}',
          client_id: '{client_id}',
        },
      },
    },
  ],
})
