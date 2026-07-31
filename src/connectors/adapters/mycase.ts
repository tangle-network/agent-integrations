import {
  declarativeRestConnector,
  type RestOperationSpec,
} from './declarative-rest.js'

const pageProperties = {
  page: { type: 'integer', minimum: 1 },
  page_size: { type: 'integer', minimum: 1, maximum: 100 },
  updated_after: { type: 'string', description: 'ISO 8601 lower timestamp bound for incremental synchronization.' },
} as const

const resourceId = { type: 'string', description: 'MyCase resource id.' } as const
const dataObject = {
  type: 'object',
  description: 'Provider-native MyCase JSON payload for this resource.',
} as const

function list(
  name: string,
  path: string,
  description: string,
  extra: Record<string, unknown> = {},
): RestOperationSpec {
  const query = Object.fromEntries(
    Object.keys({ ...pageProperties, ...extra }).map((key) => [key, `{${key}}`]),
  )
  return {
    name,
    class: 'read',
    description,
    parameters: { type: 'object', properties: { ...pageProperties, ...extra } },
    request: { method: 'GET', path, query },
  }
}

function create(name: string, path: string, description: string): RestOperationSpec {
  return {
    name,
    class: 'mutation',
    description,
    parameters: {
      type: 'object',
      properties: { data: dataObject },
      required: ['data'],
    },
    request: { method: 'POST', path, body: '{data}' },
    cas: 'native-idempotency',
    externalEffect: true,
  }
}

function update(name: string, path: string, description: string): RestOperationSpec {
  return {
    name,
    class: 'mutation',
    description,
    parameters: {
      type: 'object',
      properties: { id: resourceId, data: dataObject },
      required: ['id', 'data'],
    },
    request: { method: 'PUT', path: `${path}/{id}`, body: '{data}' },
    cas: 'optimistic-read-verify',
    externalEffect: true,
  }
}

/** MyCase External Integrations API v1. */
export const mycaseConnector = declarativeRestConnector({
  kind: 'mycase',
  displayName: 'MyCase',
  description:
    'Manage legal cases, clients, companies, leads, matters, activities, time, expenses, and notes in MyCase.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://auth.mycase.com/login_sessions/new',
    tokenUrl: 'https://auth.mycase.com/tokens',
    scopes: [],
    sendScopeParam: false,
    clientIdEnv: 'MYCASE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MYCASE_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://external-integrations.mycase.com/v1',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/staff', query: { page_size: 1 } },
  capabilities: [
    list('cases.list', '/cases', 'List or incrementally synchronize legal cases.', {
      name: { type: 'string' },
      case_number: { type: 'string' },
      case_stage_id: { type: 'string' },
      practice_area_id: { type: 'string' },
      status: { type: 'string' },
    }),
    create('cases.create', '/cases', 'Create a legal case.'),
    update('cases.update', '/cases', 'Update a legal case.'),

    list('clients.list', '/clients', 'List or incrementally synchronize clients.', {
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string' },
    }),
    create('clients.create', '/clients', 'Create a person/client record.'),
    update('clients.update', '/clients', 'Update a person/client record.'),

    list('companies.list', '/companies', 'List or incrementally synchronize companies.', {
      name: { type: 'string' },
      email: { type: 'string' },
    }),
    create('companies.create', '/companies', 'Create a company record.'),
    update('companies.update', '/companies', 'Update a company record.'),

    list('leads.list', '/leads', 'List or incrementally synchronize leads.', {
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string' },
      status: { type: 'string' },
    }),
    create('leads.create', '/leads', 'Create a lead.'),

    list('staff.list', '/staff', 'List firm staff who can own or participate in work.', {
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string' },
    }),
    list('case-stages.list', '/case_stages', 'List case stages.'),
    create('case-stages.create', '/case_stages', 'Create a case stage.'),
    list('practice-areas.list', '/practice_areas', 'List practice areas.'),
    create('practice-areas.create', '/practice_areas', 'Create a practice area.'),
    list('referral-sources.list', '/referral_sources', 'List referral sources.'),
    create('referral-sources.create', '/referral_sources', 'Create a referral source.'),
    list('people-groups.list', '/people_groups', 'List people groups.'),
    list('locations.list', '/locations', 'List office and event locations.', {
      name: { type: 'string' },
    }),
    create('locations.create', '/locations', 'Create a location.'),

    list('events.list', '/events', 'List or incrementally synchronize calendar events.', {
      start_date: { type: 'string' },
      end_date: { type: 'string' },
      case_id: { type: 'string' },
    }),
    create('events.create', '/events', 'Create a calendar event.'),
    list('tasks.list', '/tasks', 'List or incrementally synchronize tasks.', {
      due_date_start: { type: 'string' },
      due_date_end: { type: 'string' },
      case_id: { type: 'string' },
      assignee_id: { type: 'string' },
      completed: { type: 'boolean' },
    }),
    create('tasks.create', '/tasks', 'Create a task.'),
    list('calls.list', '/calls', 'List logged calls.', {
      caller_id: { type: 'string' },
      caller_type: { type: 'string', enum: ['client', 'lead'] },
      staff_id: { type: 'string' },
    }),
    create('calls.create', '/calls', 'Log a call.'),
    list('time-entries.list', '/time_entries', 'List time entries.', {
      case_id: { type: 'string' },
      staff_id: { type: 'string' },
      start_date: { type: 'string' },
      end_date: { type: 'string' },
    }),
    create('time-entries.create', '/time_entries', 'Create a time entry.'),
    list('expenses.list', '/expenses', 'List case expenses.', {
      case_id: { type: 'string' },
      staff_id: { type: 'string' },
      start_date: { type: 'string' },
      end_date: { type: 'string' },
    }),
    create('expenses.create', '/expenses', 'Create a case expense.'),

    {
      name: 'case-notes.create',
      class: 'mutation',
      description: 'Add a note to a case.',
      parameters: {
        type: 'object',
        properties: { caseId: resourceId, data: dataObject },
        required: ['caseId', 'data'],
      },
      request: { method: 'POST', path: '/cases/{caseId}/notes', body: '{data}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'client-notes.create',
      class: 'mutation',
      description: 'Add a note to a client.',
      parameters: {
        type: 'object',
        properties: { clientId: resourceId, data: dataObject },
        required: ['clientId', 'data'],
      },
      request: { method: 'POST', path: '/clients/{clientId}/notes', body: '{data}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'company-notes.create',
      class: 'mutation',
      description: 'Add a note to a company.',
      parameters: {
        type: 'object',
        properties: { companyId: resourceId, data: dataObject },
        required: ['companyId', 'data'],
      },
      request: { method: 'POST', path: '/companies/{companyId}/notes', body: '{data}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    create('custom-fields.create', '/custom_fields', 'Create a custom field definition.'),
  ],
})
