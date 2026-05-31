import { declarativeRestConnector } from './declarative-rest.js'

/**
 * BambooHR connector.
 *
 * Auth model: BambooHR exposes a per-user API key (Employee → Settings → API
 * Keys → "Add a new key") that authenticates against the Gateway REST API
 * using HTTP Basic — the key is the username, any non-empty string is the
 * password (the docs use the literal `x`). OAuth 2.0 exists on paper but is
 * gated to verified BambooHR Marketplace partners; the API-key path is the
 * one a tenant can self-serve. We therefore model auth as `api-key` and
 * expect the integrator to persist the base64 of `<apiKey>:x` as the
 * connection's `apiKey` value — that string is placed verbatim in the HTTP
 * `Authorization: Basic <…>` header.
 *
 * Base URL: `https://api.bamboohr.com/api/gateway.php/{companyDomain}/v1`,
 * where `companyDomain` is the tenant's BambooHR subdomain (the prefix in
 * `<companyDomain>.bamboohr.com`). The full Gateway URL is resolved from
 * `metadata.companyDomain` at invocation time so a single OAuth client (or
 * key) does not have to be baked per-tenant; capability paths stay relative.
 *
 * Capability surface: Employees (directory, get, create, update), Time-Off
 * (list types, list requests, create request, change status), Reports (list
 * built-in reports, run a custom report), Files (list employee files, get
 * employee file metadata). These cover the HR-automation jobs an agent
 * typically wires: onboarding lookups, PTO requests, headcount reports, and
 * file retrieval.
 *
 * Consistency model: `authoritative` — BambooHR is the system of record for
 * HR data; downstream caches MUST defer to it on conflict.
 */

const BAMBOOHR_API_VERSION = 'v1'

export const bamboohrConnector = declarativeRestConnector({
  kind: 'bamboohr',
  displayName: 'BambooHR',
  description:
    'Read and update BambooHR employee records, time-off requests, custom reports, and employee files via the BambooHR Gateway REST API.',
  auth: {
    kind: 'api-key',
    hint: 'BambooHR API key. Generate one under your BambooHR account → API Keys, then paste the base64 of `<apiKey>:x` (the literal letter x as password — BambooHR ignores the password but HTTP Basic requires one).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Per-tenant Gateway base URL. companyDomain = the prefix in
  // `<companyDomain>.bamboohr.com`. Capability paths stay relative.
  baseUrl: {
    metadataKey: 'gatewayBaseUrl',
    // Fallback honoured only when the integrator records the subdomain
    // separately under metadata.companyDomain via a higher-level resolver;
    // the declarative engine only consults a single key, so we keep the
    // canonical key explicit. A missing key triggers a clear error in the
    // engine rather than a silent default.
  },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Basic ' },
  defaultHeaders: {
    accept: 'application/json',
  },
  test: { method: 'GET', path: `${BAMBOOHR_API_VERSION}/meta/users` },
  capabilities: [
    {
      name: 'employees.directory',
      class: 'read',
      description:
        'List every employee in the BambooHR directory (id, displayName, jobTitle, workEmail, department, location, supervisor). Useful as a tenant-wide lookup table.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/employees/directory`,
      },
    },
    {
      name: 'employees.get',
      class: 'read',
      description:
        'Fetch a single employee record by id. Pass `fields` as a comma-separated list of BambooHR field aliases (firstName,lastName,workEmail,jobTitle,hireDate,…).',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string', description: 'BambooHR employee id (or "0" for the API-key owner).' },
          fields: {
            type: 'string',
            description: 'Comma-separated field aliases to project; required by BambooHR.',
          },
        },
        required: ['employeeId', 'fields'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}`,
        query: { fields: '{fields}' },
      },
    },
    {
      name: 'employees.create',
      class: 'mutation',
      description:
        'Create a new employee. Body is a flat object of BambooHR field aliases (firstName, lastName, workEmail, jobTitle, department, hireDate). BambooHR returns the new employee id in the `Location` response header.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description: 'Flat map of BambooHR field aliases → values. firstName and lastName are required.',
          },
        },
        required: ['fields'],
      },
      request: {
        method: 'POST',
        path: `${BAMBOOHR_API_VERSION}/employees/`,
        body: '{fields}',
      },
      // BambooHR does not dedupe employee POSTs; replay creates a duplicate.
      // Caller owns dedupe via the SDK's idempotency key.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'employees.update',
      class: 'mutation',
      description:
        'Update an existing employee. Body is a flat object of BambooHR field aliases → new values. BambooHR returns 200 with no body on success.',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['employeeId', 'fields'],
      },
      request: {
        method: 'POST',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}`,
        body: '{fields}',
      },
      // Last-write-wins on the BambooHR side; no etag, no If-Match. Mark as
      // optimistic-read-verify so the SDK encourages a read-before-write.
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'employees.list_custom_table',
      class: 'read',
      description:
        'Read a row set from a BambooHR table (jobInfo, compensation, employmentStatus, …) for a single employee. Returns one entry per historical row.',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          tableName: {
            type: 'string',
            description: 'BambooHR table alias, e.g. jobInfo, compensation, employmentStatus.',
          },
        },
        required: ['employeeId', 'tableName'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}/tables/{tableName}`,
      },
    },
    {
      name: 'timeoff.types.list',
      class: 'read',
      description: 'List the time-off types configured for the tenant (vacation, sick, jury duty, …). Returns id, name, units.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/meta/time_off/types`,
      },
    },
    {
      name: 'timeoff.requests.list',
      class: 'read',
      description:
        'List time-off requests in a date window. `start` and `end` are ISO-8601 dates (YYYY-MM-DD); `status` filters by approved/denied/superseded/requested.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', format: 'date' },
          end: { type: 'string', format: 'date' },
          employeeId: { type: 'string' },
          status: { type: 'string', enum: ['approved', 'denied', 'superseded', 'requested', 'canceled'] },
          type: { type: 'string', description: 'Time-off type id.' },
        },
        required: ['start', 'end'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/time_off/requests`,
        query: {
          start: '{start}',
          end: '{end}',
          employeeId: '{employeeId}',
          status: '{status}',
          type: '{type}',
        },
      },
    },
    {
      name: 'timeoff.requests.create',
      class: 'mutation',
      description:
        'File a time-off request on behalf of an employee. status defaults to "requested" so it routes through the tenant\'s normal approval chain.',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          status: { type: 'string', enum: ['approved', 'denied', 'superseded', 'requested'] },
          start: { type: 'string', format: 'date' },
          end: { type: 'string', format: 'date' },
          timeOffTypeId: { type: 'integer' },
          amount: { type: 'number', description: 'Hours or days depending on the time-off type units.' },
          notes: { type: 'object', description: 'Free-form notes; BambooHR shows them on the request.' },
          dates: {
            type: 'array',
            description: 'Optional per-day breakdown ({date, amount}).',
            items: { type: 'object' },
          },
        },
        required: ['employeeId', 'start', 'end', 'timeOffTypeId', 'amount'],
      },
      request: {
        method: 'PUT',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}/time_off/request`,
        body: {
          status: '{status}',
          start: '{start}',
          end: '{end}',
          timeOffTypeId: '{timeOffTypeId}',
          amount: '{amount}',
          notes: '{notes}',
          dates: '{dates}',
        },
      },
      // PUT to the request endpoint is upsert-shaped on BambooHR: each call
      // creates a fresh request id, so the server does not dedupe. Caller
      // owns dedupe.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'timeoff.requests.change_status',
      class: 'mutation',
      description:
        'Approve, deny, or cancel an existing time-off request. status must be one of approved | denied | superseded | requested | canceled.',
      parameters: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          status: { type: 'string', enum: ['approved', 'denied', 'superseded', 'requested', 'canceled'] },
          note: { type: 'string' },
        },
        required: ['requestId', 'status'],
      },
      request: {
        method: 'PUT',
        path: `${BAMBOOHR_API_VERSION}/time_off/requests/{requestId}/status`,
        body: { status: '{status}', note: '{note}' },
      },
      // Re-PUTting the same terminal status is a no-op on BambooHR.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'reports.list',
      class: 'read',
      description: 'List the tenant\'s saved custom reports (id, name, owner). Use the id with `reports.run`.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/reports`,
      },
    },
    {
      name: 'reports.run',
      class: 'read',
      description:
        'Run a saved BambooHR report by id and return its rows. format defaults to JSON; set fd=yes to flatten field aliases into the response keys.',
      parameters: {
        type: 'object',
        properties: {
          reportId: { type: 'string' },
          format: { type: 'string', enum: ['JSON', 'CSV', 'PDF', 'XLS', 'XML'] },
          fd: { type: 'string', enum: ['yes', 'no'], description: 'Field-data toggle.' },
        },
        required: ['reportId'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/reports/{reportId}`,
        query: { format: '{format}', fd: '{fd}' },
      },
    },
    {
      name: 'reports.custom',
      class: 'mutation',
      description:
        'Build an ad-hoc report from a list of field aliases. Body matches BambooHR\'s custom-report contract: { title, fields, filters?, includeWorkflowStatus? }.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          fields: {
            type: 'array',
            description: 'BambooHR field aliases to include as report columns.',
            items: { type: 'string' },
          },
          filters: { type: 'object' },
          includeWorkflowStatus: { type: 'boolean' },
          format: { type: 'string', enum: ['JSON', 'CSV', 'PDF', 'XLS', 'XML'] },
        },
        required: ['title', 'fields'],
      },
      request: {
        method: 'POST',
        path: `${BAMBOOHR_API_VERSION}/reports/custom`,
        query: { format: '{format}' },
        body: {
          title: '{title}',
          fields: '{fields}',
          filters: '{filters}',
          includeWorkflowStatus: '{includeWorkflowStatus}',
        },
      },
      // Read-shaped operation that BambooHR happens to expose as POST (body
      // carries the projection spec); no server-side state changes.
      cas: 'none',
      externalEffect: false,
    },
    {
      name: 'files.list',
      class: 'read',
      description: 'List the files attached to an employee (id, name, originalFileName, size, dateCreated, category).',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
        },
        required: ['employeeId'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}/files/view/`,
      },
    },
    {
      name: 'files.get_metadata',
      class: 'read',
      description:
        'Fetch a single employee file\'s metadata by id. To download bytes, the caller follows the returned URL with the same credentials.',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          fileId: { type: 'string' },
        },
        required: ['employeeId', 'fileId'],
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/employees/{employeeId}/files/{fileId}`,
      },
    },
    {
      name: 'meta.fields',
      class: 'read',
      description: 'List every BambooHR field the tenant has configured (alias, name, type). Use this to discover field aliases dynamically.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/meta/fields`,
      },
    },
    {
      name: 'meta.lists',
      class: 'read',
      description: 'List the tenant\'s list-typed field options (departments, divisions, locations, employment statuses).',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: `${BAMBOOHR_API_VERSION}/meta/lists`,
      },
    },
  ],
})
