import { declarativeRestConnector } from './declarative-rest.js'

// Gusto Embedded Payroll API.
// Production base: https://api.gusto.com
// Demo / sandbox base: https://api.gusto-demo.com (consumer can override via metadata.apiBaseUrl)
//
// Auth: OAuth2 authorization-code grant against api.gusto.com. Gusto does not
// use the OAuth `scope` query parameter — access is governed by the role
// (company admin / contractor / employee) that authorizes the connection.
// We surface the documented capability scopes on each operation so the hub's
// policy layer still has a permission vocabulary to gate on, even though
// they're not sent in the authorize URL.
//
// API versioning: Gusto requires an `X-Gusto-API-Version` request header.
// Pinned here to 2024-04-01 (the stable Embedded payroll surface as of this
// adapter). Consumers can bump via `defaultHeaders` override at the deployment
// layer if they want a newer dated version.
export const gustoConnector = declarativeRestConnector({
  kind: 'gusto',
  displayName: 'Gusto',
  description: 'Read Gusto companies, employees, jobs, compensations, contractors, and payrolls; create payrolls and run mutations against the Embedded API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.gusto.com/oauth/authorize',
    tokenUrl: 'https://api.gusto.com/oauth/token',
    // Gusto's OAuth flow ignores `scope` in the authorize URL; these are
    // capability-level scope hints surfaced to the hub policy layer.
    scopes: [
      'companies:read',
      'employees:read',
      'employees:write',
      'jobs:read',
      'jobs:write',
      'compensations:read',
      'compensations:write',
      'contractors:read',
      'contractors:write',
      'payrolls:read',
      'payrolls:write',
    ],
    clientIdEnv: 'GUSTO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GUSTO_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.gusto.com' },
  defaultHeaders: {
    'X-Gusto-API-Version': '2024-04-01',
  },
  test: { method: 'GET', path: '/v1/me' },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Return the authenticated user (current_user) including the companies and roles the token can access.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/me' },
      requiredScopes: ['companies:read'],
    },
    {
      name: 'companies.get',
      class: 'read',
      description: 'Read a Gusto company by uuid.',
      parameters: {
        type: 'object',
        properties: { company_uuid: { type: 'string' } },
        required: ['company_uuid'],
      },
      request: { method: 'GET', path: '/v1/companies/{company_uuid}' },
      requiredScopes: ['companies:read'],
    },
    {
      name: 'employees.list',
      class: 'read',
      description: 'List the employees of a company. Supports `terminated` and pagination via `page` / `per`.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          terminated: { type: 'boolean' },
          page: { type: 'integer', minimum: 1 },
          per: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['company_uuid'],
      },
      request: {
        method: 'GET',
        path: '/v1/companies/{company_uuid}/employees',
        query: { terminated: '{terminated}', page: '{page}', per: '{per}' },
      },
      requiredScopes: ['employees:read'],
    },
    {
      name: 'employees.get',
      class: 'read',
      description: 'Read a Gusto employee by uuid.',
      parameters: {
        type: 'object',
        properties: { employee_uuid: { type: 'string' } },
        required: ['employee_uuid'],
      },
      request: { method: 'GET', path: '/v1/employees/{employee_uuid}' },
      requiredScopes: ['employees:read'],
    },
    {
      name: 'employees.create',
      class: 'mutation',
      description: 'Create an employee on a company. `first_name`, `last_name`, and `work_email` are required.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          first_name: { type: 'string' },
          middle_initial: { type: 'string' },
          last_name: { type: 'string' },
          date_of_birth: { type: 'string', format: 'date' },
          email: { type: 'string', format: 'email' },
          work_email: { type: 'string', format: 'email' },
          ssn: { type: 'string' },
          self_onboarding: { type: 'boolean' },
        },
        required: ['company_uuid', 'first_name', 'last_name'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/{company_uuid}/employees',
        body: {
          first_name: '{first_name}',
          middle_initial: '{middle_initial}',
          last_name: '{last_name}',
          date_of_birth: '{date_of_birth}',
          email: '{email}',
          work_email: '{work_email}',
          ssn: '{ssn}',
          self_onboarding: '{self_onboarding}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['employees:write'],
    },
    {
      name: 'employees.update',
      class: 'mutation',
      description: 'Update a Gusto employee. Caller must supply `version` (the optimistic-concurrency token from the prior read).',
      parameters: {
        type: 'object',
        properties: {
          employee_uuid: { type: 'string' },
          version: { type: 'string' },
          first_name: { type: 'string' },
          middle_initial: { type: 'string' },
          last_name: { type: 'string' },
          date_of_birth: { type: 'string', format: 'date' },
          email: { type: 'string', format: 'email' },
          work_email: { type: 'string', format: 'email' },
          two_percent_shareholder: { type: 'boolean' },
        },
        required: ['employee_uuid', 'version'],
      },
      request: {
        method: 'PUT',
        path: '/v1/employees/{employee_uuid}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['employees:write'],
    },
    {
      name: 'employees.terminate',
      class: 'mutation',
      description: 'Create a termination record for an employee.',
      parameters: {
        type: 'object',
        properties: {
          employee_uuid: { type: 'string' },
          effective_date: { type: 'string', format: 'date' },
          run_termination_payroll: { type: 'boolean' },
        },
        required: ['employee_uuid', 'effective_date'],
      },
      request: {
        method: 'POST',
        path: '/v1/employees/{employee_uuid}/terminations',
        body: {
          effective_date: '{effective_date}',
          run_termination_payroll: '{run_termination_payroll}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['employees:write'],
    },
    {
      name: 'jobs.list',
      class: 'read',
      description: 'List the jobs assigned to an employee.',
      parameters: {
        type: 'object',
        properties: { employee_uuid: { type: 'string' } },
        required: ['employee_uuid'],
      },
      request: { method: 'GET', path: '/v1/employees/{employee_uuid}/jobs' },
      requiredScopes: ['jobs:read'],
    },
    {
      name: 'jobs.create',
      class: 'mutation',
      description: 'Create a job for an employee.',
      parameters: {
        type: 'object',
        properties: {
          employee_uuid: { type: 'string' },
          title: { type: 'string' },
          location_uuid: { type: 'string' },
          hire_date: { type: 'string', format: 'date' },
          two_percent_shareholder: { type: 'boolean' },
        },
        required: ['employee_uuid', 'title', 'hire_date'],
      },
      request: {
        method: 'POST',
        path: '/v1/employees/{employee_uuid}/jobs',
        body: {
          title: '{title}',
          location_uuid: '{location_uuid}',
          hire_date: '{hire_date}',
          two_percent_shareholder: '{two_percent_shareholder}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['jobs:write'],
    },
    {
      name: 'jobs.update',
      class: 'mutation',
      description: 'Update a job. Caller must supply `version` from the prior read.',
      parameters: {
        type: 'object',
        properties: {
          job_uuid: { type: 'string' },
          version: { type: 'string' },
          title: { type: 'string' },
          location_uuid: { type: 'string' },
          hire_date: { type: 'string', format: 'date' },
          two_percent_shareholder: { type: 'boolean' },
        },
        required: ['job_uuid', 'version'],
      },
      request: {
        method: 'PUT',
        path: '/v1/jobs/{job_uuid}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['jobs:write'],
    },
    {
      name: 'compensations.list',
      class: 'read',
      description: 'List compensations attached to a job.',
      parameters: {
        type: 'object',
        properties: { job_uuid: { type: 'string' } },
        required: ['job_uuid'],
      },
      request: { method: 'GET', path: '/v1/jobs/{job_uuid}/compensations' },
      requiredScopes: ['compensations:read'],
    },
    {
      name: 'compensations.create',
      class: 'mutation',
      description: 'Create a compensation record on a job. `rate` is a stringified decimal, `payment_unit` is one of "Hour" | "Week" | "Month" | "Year" | "Paycheck".',
      parameters: {
        type: 'object',
        properties: {
          job_uuid: { type: 'string' },
          rate: { type: 'string' },
          payment_unit: {
            type: 'string',
            enum: ['Hour', 'Week', 'Month', 'Year', 'Paycheck'],
          },
          flsa_status: {
            type: 'string',
            enum: ['Exempt', 'Salaried Nonexempt', 'Nonexempt', 'Owner'],
          },
          effective_date: { type: 'string', format: 'date' },
          adjust_for_minimum_wage: { type: 'boolean' },
        },
        required: ['job_uuid', 'rate', 'payment_unit', 'flsa_status', 'effective_date'],
      },
      request: {
        method: 'POST',
        path: '/v1/jobs/{job_uuid}/compensations',
        body: {
          rate: '{rate}',
          payment_unit: '{payment_unit}',
          flsa_status: '{flsa_status}',
          effective_date: '{effective_date}',
          adjust_for_minimum_wage: '{adjust_for_minimum_wage}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['compensations:write'],
    },
    {
      name: 'compensations.update',
      class: 'mutation',
      description: 'Update a compensation record. Caller must supply `version` from the prior read.',
      parameters: {
        type: 'object',
        properties: {
          compensation_uuid: { type: 'string' },
          version: { type: 'string' },
          rate: { type: 'string' },
          payment_unit: {
            type: 'string',
            enum: ['Hour', 'Week', 'Month', 'Year', 'Paycheck'],
          },
          flsa_status: {
            type: 'string',
            enum: ['Exempt', 'Salaried Nonexempt', 'Nonexempt', 'Owner'],
          },
          effective_date: { type: 'string', format: 'date' },
          adjust_for_minimum_wage: { type: 'boolean' },
        },
        required: ['compensation_uuid', 'version'],
      },
      request: {
        method: 'PUT',
        path: '/v1/compensations/{compensation_uuid}',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['compensations:write'],
    },
    {
      name: 'contractors.list',
      class: 'read',
      description: 'List the contractors of a company.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['company_uuid'],
      },
      request: {
        method: 'GET',
        path: '/v1/companies/{company_uuid}/contractors',
        query: { page: '{page}', per: '{per}' },
      },
      requiredScopes: ['contractors:read'],
    },
    {
      name: 'contractors.get',
      class: 'read',
      description: 'Read a contractor by uuid.',
      parameters: {
        type: 'object',
        properties: { contractor_uuid: { type: 'string' } },
        required: ['contractor_uuid'],
      },
      request: { method: 'GET', path: '/v1/contractors/{contractor_uuid}' },
      requiredScopes: ['contractors:read'],
    },
    {
      name: 'contractors.create',
      class: 'mutation',
      description: 'Create a contractor on a company. `type` is "Individual" or "Business"; for "Business" supply `business_name`, for "Individual" supply `first_name` + `last_name`.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          type: { type: 'string', enum: ['Individual', 'Business'] },
          wage_type: { type: 'string', enum: ['Fixed', 'Hourly'] },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          business_name: { type: 'string' },
          ein: { type: 'string' },
          email: { type: 'string', format: 'email' },
          start_date: { type: 'string', format: 'date' },
          self_onboarding: { type: 'boolean' },
        },
        required: ['company_uuid', 'type', 'wage_type', 'start_date'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/{company_uuid}/contractors',
        body: {
          type: '{type}',
          wage_type: '{wage_type}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          business_name: '{business_name}',
          ein: '{ein}',
          email: '{email}',
          start_date: '{start_date}',
          self_onboarding: '{self_onboarding}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['contractors:write'],
    },
    {
      name: 'payrolls.list',
      class: 'read',
      description: 'List a company\'s payrolls. Supports `processed`, `include_off_cycle`, `start_date`, `end_date` filters.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          processed: { type: 'boolean' },
          include_off_cycle: { type: 'boolean' },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          page: { type: 'integer', minimum: 1 },
          per: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['company_uuid'],
      },
      request: {
        method: 'GET',
        path: '/v1/companies/{company_uuid}/payrolls',
        query: {
          processed: '{processed}',
          include_off_cycle: '{include_off_cycle}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          page: '{page}',
          per: '{per}',
        },
      },
      requiredScopes: ['payrolls:read'],
    },
    {
      name: 'payrolls.get',
      class: 'read',
      description: 'Read a single payroll. `include` accepts comma-separated extras (e.g. "benefits,deductions,taxes").',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          payroll_uuid: { type: 'string' },
          include: { type: 'string' },
          show_calculation: { type: 'boolean' },
        },
        required: ['company_uuid', 'payroll_uuid'],
      },
      request: {
        method: 'GET',
        path: '/v1/companies/{company_uuid}/payrolls/{payroll_uuid}',
        query: { include: '{include}', show_calculation: '{show_calculation}' },
      },
      requiredScopes: ['payrolls:read'],
    },
    {
      name: 'payrolls.create_off_cycle',
      class: 'mutation',
      description: 'Create an off-cycle payroll for a company. `off_cycle_reason` is one of "Bonus" | "Correction" | "Dismissed Employee" | "Transition From Old Pay Schedule".',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          off_cycle_reason: {
            type: 'string',
            enum: ['Bonus', 'Correction', 'Dismissed Employee', 'Transition From Old Pay Schedule'],
          },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          check_date: { type: 'string', format: 'date' },
          employee_uuids: { type: 'array', items: { type: 'string' } },
          withholding_pay_period: {
            type: 'string',
            enum: ['Every week', 'Every other week', 'Twice per month', 'Monthly', 'Quarterly', 'Semiannually', 'Annually'],
          },
        },
        required: ['company_uuid', 'off_cycle_reason', 'start_date', 'end_date', 'check_date'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/{company_uuid}/payrolls',
        body: {
          off_cycle: true,
          off_cycle_reason: '{off_cycle_reason}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          check_date: '{check_date}',
          employee_uuids: '{employee_uuids}',
          withholding_pay_period: '{withholding_pay_period}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['payrolls:write'],
    },
    {
      name: 'payrolls.submit',
      class: 'mutation',
      description: 'Submit a previously-prepared payroll for processing. Once submitted Gusto begins funds movement.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          payroll_uuid: { type: 'string' },
        },
        required: ['company_uuid', 'payroll_uuid'],
      },
      request: {
        method: 'PUT',
        path: '/v1/companies/{company_uuid}/payrolls/{payroll_uuid}/submit',
      },
      cas: 'native-idempotency',
      requiredScopes: ['payrolls:write'],
    },
    {
      name: 'payrolls.cancel',
      class: 'mutation',
      description: 'Cancel a submitted-but-not-yet-processed payroll.',
      parameters: {
        type: 'object',
        properties: {
          company_uuid: { type: 'string' },
          payroll_uuid: { type: 'string' },
        },
        required: ['company_uuid', 'payroll_uuid'],
      },
      request: {
        method: 'PUT',
        path: '/v1/companies/{company_uuid}/payrolls/{payroll_uuid}/cancel',
      },
      cas: 'native-idempotency',
      requiredScopes: ['payrolls:write'],
    },
  ],
})
