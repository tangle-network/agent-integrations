import { declarativeRestConnector } from './declarative-rest.js'

// Housecall Pro Public API — REST over https://api.housecallpro.com. The
// activepieces piece exposes a CRM-shaped auth surface (api-key) and a set of
// job / lead / customer mutations whose parameters are described by the piece's
// authFields. The capabilities below cover those documented mutation surfaces
// plus the matching reads needed to drive them from an agent.
export const housecallProConnector = declarativeRestConnector({
  kind: 'housecall-pro',
  displayName: 'Housecall Pro',
  description:
    'Manage Housecall Pro customers, jobs, leads, line items, attachments, notes, and tags for home-service CRM workflows.',
  auth: {
    kind: 'api-key',
    hint: 'Housecall Pro Public API key (Settings → API). Sent as a Bearer token on every request.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.housecallpro.com',
  test: { method: 'GET', path: '/company' },
  capabilities: [
    {
      name: 'customers.search',
      class: 'read',
      description: 'Search customers by name, email, or phone number.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      request: {
        method: 'GET',
        path: '/customers',
        query: { q: '{q}', page: '{page}', page_size: '{page_size}' },
      },
    },
    {
      name: 'customers.get',
      class: 'read',
      description: 'Read a single customer by id.',
      parameters: {
        type: 'object',
        properties: { customer_id: { type: 'string' } },
        required: ['customer_id'],
      },
      request: { method: 'GET', path: '/customers/{customer_id}' },
    },
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a new Housecall Pro customer.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          mobile_number: { type: 'string' },
          home_number: { type: 'string' },
          work_number: { type: 'string' },
          company: { type: 'string' },
          notifications_enabled: { type: 'boolean' },
        },
      },
      request: {
        method: 'POST',
        path: '/customers',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          email: '{email}',
          mobile_number: '{mobile_number}',
          home_number: '{home_number}',
          work_number: '{work_number}',
          company: '{company}',
          notifications_enabled: '{notifications_enabled}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'customers.update',
      class: 'mutation',
      description: 'Update an existing Housecall Pro customer.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          mobile_number: { type: 'string' },
          home_number: { type: 'string' },
          work_number: { type: 'string' },
          company: { type: 'string' },
          notifications_enabled: { type: 'boolean' },
        },
        required: ['customer_id'],
      },
      request: {
        method: 'PUT',
        path: '/customers/{customer_id}',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          email: '{email}',
          mobile_number: '{mobile_number}',
          home_number: '{home_number}',
          work_number: '{work_number}',
          company: '{company}',
          notifications_enabled: '{notifications_enabled}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'customers.addresses.create',
      class: 'mutation',
      description: 'Add an address to an existing customer.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          street: { type: 'string' },
          street_line_2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          country: { type: 'string' },
          type: { type: 'string' },
        },
        required: ['customer_id', 'street', 'city', 'state'],
      },
      request: {
        method: 'POST',
        path: '/customers/{customer_id}/addresses',
        body: {
          street: '{street}',
          street_line_2: '{street_line_2}',
          city: '{city}',
          state: '{state}',
          zip: '{zip}',
          country: '{country}',
          type: '{type}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'jobs.search',
      class: 'read',
      description: 'Search jobs by customer, status, or scheduled date window.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          work_status: { type: 'string' },
          scheduled_start_min: { type: 'string' },
          scheduled_start_max: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      request: {
        method: 'GET',
        path: '/jobs',
        query: {
          customer_id: '{customer_id}',
          work_status: '{work_status}',
          scheduled_start_min: '{scheduled_start_min}',
          scheduled_start_max: '{scheduled_start_max}',
          page: '{page}',
          page_size: '{page_size}',
        },
      },
    },
    {
      name: 'jobs.get',
      class: 'read',
      description: 'Read a single job by id.',
      parameters: {
        type: 'object',
        properties: { job_id: { type: 'string' } },
        required: ['job_id'],
      },
      request: { method: 'GET', path: '/jobs/{job_id}' },
    },
    {
      name: 'jobs.update',
      class: 'mutation',
      description:
        'Update a job, including replacing or appending its line items and refreshing input materials.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          line_items: { type: 'array' },
          append_line_items: { type: 'boolean' },
          job_input_materials: { type: 'array' },
          work_status: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['job_id'],
      },
      request: {
        method: 'PUT',
        path: '/jobs/{job_id}',
        body: {
          line_items: '{line_items}',
          append_line_items: '{append_line_items}',
          job_input_materials: '{job_input_materials}',
          work_status: '{work_status}',
          description: '{description}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'jobs.line_items.create',
      class: 'mutation',
      description: 'Create a single line item on a job.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          unit_price: { type: 'number' },
          unit_cost: { type: 'number' },
          quantity: { type: 'number' },
          taxable: { type: 'boolean' },
          kind: { type: 'string' },
          tax_surcharge_type: { type: 'string' },
          service_line_id: { type: 'string' },
          service_line_type: { type: 'string' },
        },
        required: ['job_id', 'name'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{job_id}/line_items',
        body: {
          name: '{name}',
          description: '{description}',
          unit_price: '{unit_price}',
          unit_cost: '{unit_cost}',
          quantity: '{quantity}',
          taxable: '{taxable}',
          kind: '{kind}',
          tax_surcharge_type: '{tax_surcharge_type}',
          service_line_id: '{service_line_id}',
          service_line_type: '{service_line_type}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'jobs.notes.create',
      class: 'mutation',
      description: 'Add a note to a job.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['job_id', 'content'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{job_id}/notes',
        body: { content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'jobs.attachments.create',
      class: 'mutation',
      description: 'Upload a file attachment to a job.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          name: { type: 'string' },
          file: { type: 'string' },
          content_type: { type: 'string' },
        },
        required: ['job_id', 'name', 'file'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{job_id}/attachments',
        body: {
          name: '{name}',
          file: '{file}',
          content_type: '{content_type}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'jobs.tags.add',
      class: 'mutation',
      description: 'Apply a tag to a job by tag id.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          tag_id: { type: 'string' },
        },
        required: ['job_id', 'tag_id'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{job_id}/tags',
        body: { tag_id: '{tag_id}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.search',
      class: 'read',
      description: 'Search leads by status or assigned employee.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          assigned_employee_id: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          status: '{status}',
          assigned_employee_id: '{assigned_employee_id}',
          page: '{page}',
          page_size: '{page_size}',
        },
      },
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Read a single lead by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/leads/{id}' },
    },
    {
      name: 'leads.convert',
      class: 'mutation',
      description: 'Convert a lead into an estimate or a job. type must be "estimate" or "job".',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['estimate', 'job'] },
        },
        required: ['id', 'type'],
      },
      request: {
        method: 'POST',
        path: '/leads/{id}/convert',
        body: { type: '{type}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
