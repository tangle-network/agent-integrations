import { declarativeRestConnector } from './declarative-rest.js'

export const twentyConnector = declarativeRestConnector({
  kind: 'twenty',
  displayName: 'Twenty',
  description: 'Open-source CRM platform. Create and manage contacts, companies, and opportunities.',
  auth: { kind: 'api-key', hint: 'Twenty API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/graphql' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact in Twenty.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['firstName', 'email'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation CreateContact($input: CreateContactInput!) { createContact(input: $input) { id firstName lastName email phone } }',
          variables: {
            input: {
              firstName: '{firstName}',
              lastName: '{lastName}',
              email: '{email}',
              phone: '{phone}',
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Find a person by email or other criteria.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'query FindPerson($email: String!) { people(filter: { email: { eq: $email } }) { edges { node { id firstName lastName email } } } }',
          variables: {
            email: '{email}',
          },
        },
      },
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a contact in Twenty.',
      parameters: {
        type: 'object',
        properties: {
          personId: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['personId'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation UpdatePerson($input: UpdatePersonInput!) { updatePerson(input: $input) { id firstName lastName email phone } }',
          variables: {
            input: {
              id: '{personId}',
              firstName: '{firstName}',
              lastName: '{lastName}',
              email: '{email}',
              phone: '{phone}',
            },
          },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'companies.create',
      class: 'mutation',
      description: 'Create a new company in Twenty.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domainName: { type: 'string' },
          address: { type: 'string' },
          employees: { type: 'integer' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation CreateCompany($input: CreateCompanyInput!) { createCompany(input: $input) { id name domainName address employees } }',
          variables: {
            input: {
              name: '{name}',
              domainName: '{domainName}',
              address: '{address}',
              employees: '{employees}',
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'companies.find',
      class: 'read',
      description: 'Find a company by name or domain.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'query FindCompany($name: String!) { companies(filter: { name: { ilike: $name } }) { edges { node { id name domainName address employees } } } }',
          variables: {
            name: '{name}',
          },
        },
      },
    },
    {
      name: 'companies.update',
      class: 'mutation',
      description: 'Update a company in Twenty.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string' },
          name: { type: 'string' },
          domainName: { type: 'string' },
          address: { type: 'string' },
          employees: { type: 'integer' },
        },
        required: ['companyId'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation UpdateCompany($input: UpdateCompanyInput!) { updateCompany(input: $input) { id name domainName address employees } }',
          variables: {
            input: {
              id: '{companyId}',
              name: '{name}',
              domainName: '{domainName}',
              address: '{address}',
              employees: '{employees}',
            },
          },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'opportunities.create',
      class: 'mutation',
      description: 'Create a new opportunity in Twenty.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          stage: { type: 'string' },
          closeDate: { type: 'string' },
          companyId: { type: 'string' },
        },
        required: ['name', 'companyId'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: 'mutation CreateOpportunity($input: CreateOpportunityInput!) { createOpportunity(input: $input) { id name amount currency stage closeDate } }',
          variables: {
            input: {
              name: '{name}',
              amount: '{amount}',
              currency: '{currency}',
              stage: '{stage}',
              closeDate: '{closeDate}',
              companyId: '{companyId}',
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
