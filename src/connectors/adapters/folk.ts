import { declarativeRestConnector } from './declarative-rest.js'

export const folkConnector = declarativeRestConnector({
  kind: 'folk',
  displayName: 'Folk',
  description:
    'Folk CRM: manage companies and people for relationship-driven sales workflows.',
  auth: { kind: 'api-key', hint: 'Folk personal API key (sent as a Bearer token).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.folk.app/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'create.company',
      class: 'mutation',
      description: 'Create a company record in Folk.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name of the company.' },
          description: { type: 'string', description: 'A short description of the company.' },
          industry: { type: 'string', description: 'The industry the company operates in.' },
          addresses: {
            type: 'array',
            items: { type: 'object' },
            description: 'Physical addresses for the company. The first address is primary.',
          },
          emails: {
            type: 'array',
            items: { type: 'object' },
            description: 'Email addresses for the company. The first email is primary.',
          },
          phones: {
            type: 'array',
            items: { type: 'object' },
            description: 'Phone numbers for the company. The first phone is primary.',
          },
          urls: {
            type: 'array',
            items: { type: 'object' },
            description: 'Website URLs for the company. The first URL is primary.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/companies',
        body: {
          name: '{name}',
          description: '{description}',
          industry: '{industry}',
          addresses: '{addresses}',
          emails: '{emails}',
          phones: '{phones}',
          urls: '{urls}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.company',
      class: 'mutation',
      description: 'Update an existing company record in Folk by id.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'Folk company id.' },
          name: { type: 'string', description: 'The name of the company.' },
          description: { type: 'string', description: 'A short description of the company.' },
          industry: { type: 'string', description: 'The industry the company operates in.' },
          addresses: { type: 'array', items: { type: 'object' } },
          emails: { type: 'array', items: { type: 'object' } },
          phones: { type: 'array', items: { type: 'object' } },
          urls: { type: 'array', items: { type: 'object' } },
        },
        required: ['companyId'],
      },
      request: {
        method: 'PATCH',
        path: '/companies/{companyId}',
        body: {
          name: '{name}',
          description: '{description}',
          industry: '{industry}',
          addresses: '{addresses}',
          emails: '{emails}',
          phones: '{phones}',
          urls: '{urls}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'create.person',
      class: 'mutation',
      description: 'Create a person record in Folk.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'The first name of the person.' },
          lastName: { type: 'string', description: 'The last name of the person.' },
          fullName: {
            type: 'string',
            description: 'The full name of the person (alternative to first/last).',
          },
          birthday: { type: 'string', description: 'The birthday in YYYY-MM-DD format.' },
          jobTitle: { type: 'string', description: 'The job title of the person.' },
          emails: { type: 'array', items: { type: 'object' } },
          phones: { type: 'array', items: { type: 'object' } },
          urls: { type: 'array', items: { type: 'object' } },
          addresses: { type: 'array', items: { type: 'object' } },
          companyNames: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The names of companies to associate with the person. The first company is primary.',
          },
        },
      },
      request: {
        method: 'POST',
        path: '/people',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          fullName: '{fullName}',
          birthday: '{birthday}',
          jobTitle: '{jobTitle}',
          emails: '{emails}',
          phones: '{phones}',
          urls: '{urls}',
          addresses: '{addresses}',
          companyNames: '{companyNames}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.person',
      class: 'mutation',
      description: 'Update an existing person record in Folk by id.',
      parameters: {
        type: 'object',
        properties: {
          personId: { type: 'string', description: 'Folk person id.' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          fullName: { type: 'string' },
          birthday: { type: 'string', description: 'YYYY-MM-DD.' },
          jobTitle: { type: 'string' },
          emails: { type: 'array', items: { type: 'object' } },
          phones: { type: 'array', items: { type: 'object' } },
          urls: { type: 'array', items: { type: 'object' } },
          addresses: { type: 'array', items: { type: 'object' } },
          companyNames: { type: 'array', items: { type: 'string' } },
        },
        required: ['personId'],
      },
      request: {
        method: 'PATCH',
        path: '/people/{personId}',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          fullName: '{fullName}',
          birthday: '{birthday}',
          jobTitle: '{jobTitle}',
          emails: '{emails}',
          phones: '{phones}',
          urls: '{urls}',
          addresses: '{addresses}',
          companyNames: '{companyNames}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'find.company',
      class: 'read',
      description: 'Search Folk companies by name or other filters.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Enter company name or email to search for.',
          },
          combinator: {
            type: 'string',
            description: 'The logical operator to combine multiple filters (and, or).',
          },
          nameFilter: { type: 'string', description: 'Filter by company name (contains).' },
          emailFilter: { type: 'string', description: 'Filter by email address (contains).' },
          limit: {
            type: 'integer',
            description: 'The number of items to return (1-100).',
          },
          cursor: {
            type: 'string',
            description: 'A cursor for pagination. Use nextLink from a previous response.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/companies',
        query: {
          query: '{query}',
          combinator: '{combinator}',
          name: '{nameFilter}',
          email: '{emailFilter}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'get.company',
      class: 'read',
      description: 'Read a single Folk company by id.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'Folk company id.' },
        },
        required: ['companyId'],
      },
      request: { method: 'GET', path: '/companies/{companyId}' },
    },
    {
      name: 'find.person',
      class: 'read',
      description: 'Search Folk people by name, email, or other filters.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Enter person name or email to search for.',
          },
          combinator: {
            type: 'string',
            description: 'The logical operator to combine multiple filters (and, or).',
          },
          nameFilter: { type: 'string', description: 'Filter by person name (contains).' },
          emailFilter: { type: 'string', description: 'Filter by email address (contains).' },
          limit: {
            type: 'integer',
            description: 'The number of items to return (1-100).',
          },
          cursor: {
            type: 'string',
            description: 'A cursor for pagination. Use nextLink from a previous response.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/people',
        query: {
          query: '{query}',
          combinator: '{combinator}',
          name: '{nameFilter}',
          email: '{emailFilter}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'get.person',
      class: 'read',
      description: 'Read a single Folk person by id.',
      parameters: {
        type: 'object',
        properties: {
          personId: { type: 'string', description: 'Folk person id.' },
        },
        required: ['personId'],
      },
      request: { method: 'GET', path: '/people/{personId}' },
    },
  ],
})
