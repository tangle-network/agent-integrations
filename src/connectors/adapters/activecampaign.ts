import { declarativeRestConnector } from './declarative-rest.js'

// ActiveCampaign exposes a per-account REST host of the form
// https://{account}.api-us1.com — the connection-time `apiUrl` metadata field
// holds the resolved hostname, and the connector reads it via metadataKey.
export const activecampaignConnector = declarativeRestConnector({
  kind: 'activecampaign',
  displayName: 'ActiveCampaign',
  description:
    'Manage ActiveCampaign accounts, contacts, lists, and tags in the marketing automation + CRM platform.',
  auth: {
    kind: 'api-key',
    hint: 'ActiveCampaign API key from Settings → Developer. The connection must also store the per-account apiUrl (e.g. https://youraccount.api-us1.com).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'GET', path: '/api/3/users/me' },
  capabilities: [
    {
      name: 'accounts.create',
      class: 'mutation',
      description: 'Create an ActiveCampaign account (organization) record.',
      parameters: {
        type: 'object',
        properties: {
          account: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              accountUrl: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    customFieldId: { type: 'integer' },
                    fieldValue: { type: 'string' },
                  },
                  required: ['customFieldId', 'fieldValue'],
                },
              },
            },
            required: ['name'],
          },
        },
        required: ['account'],
      },
      request: { method: 'POST', path: '/api/3/accounts', body: { account: '{account}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'accounts.update',
      class: 'mutation',
      description: 'Update an existing ActiveCampaign account by id.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          account: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              accountUrl: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    customFieldId: { type: 'integer' },
                    fieldValue: { type: 'string' },
                  },
                  required: ['customFieldId', 'fieldValue'],
                },
              },
            },
          },
        },
        required: ['accountId', 'account'],
      },
      request: {
        method: 'PUT',
        path: '/api/3/accounts/{accountId}',
        body: { account: '{account}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.list.subscription',
      class: 'mutation',
      description:
        'Subscribe or unsubscribe a contact from a list. status=1 subscribes, status=2 unsubscribes.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'integer' },
          list: { type: 'integer' },
          status: { type: 'integer', enum: [1, 2] },
        },
        required: ['contact', 'list', 'status'],
      },
      request: {
        method: 'POST',
        path: '/api/3/contactLists',
        body: {
          contactList: {
            contact: '{contact}',
            list: '{list}',
            status: '{status}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a contact in ActiveCampaign.',
      parameters: {
        type: 'object',
        properties: {
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              phone: { type: 'string' },
              fieldValues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'integer' },
                    value: { type: 'string' },
                  },
                  required: ['field', 'value'],
                },
              },
            },
            required: ['email'],
          },
        },
        required: ['contact'],
      },
      request: { method: 'POST', path: '/api/3/contacts', body: { contact: '{contact}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing contact by id.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              phone: { type: 'string' },
              fieldValues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'integer' },
                    value: { type: 'string' },
                  },
                  required: ['field', 'value'],
                },
              },
            },
          },
        },
        required: ['contactId', 'contact'],
      },
      request: {
        method: 'PUT',
        path: '/api/3/contacts/{contactId}',
        body: { contact: '{contact}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'accounts.contacts.associate',
      class: 'mutation',
      description: 'Associate a contact with an account, optionally setting a job title.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'integer' },
          account: { type: 'integer' },
          jobTitle: { type: 'string' },
        },
        required: ['contact', 'account'],
      },
      request: {
        method: 'POST',
        path: '/api/3/accountContacts',
        body: {
          accountContact: {
            contact: '{contact}',
            account: '{account}',
            jobTitle: '{jobTitle}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.tags.add',
      class: 'mutation',
      description: 'Add a tag to a contact.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'integer' },
          tag: { type: 'integer' },
        },
        required: ['contact', 'tag'],
      },
      request: {
        method: 'POST',
        path: '/api/3/contactTags',
        body: {
          contactTag: {
            contact: '{contact}',
            tag: '{tag}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/api/3/contacts/{contactId}' },
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search contacts by email or filter parameters.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/3/contacts',
        query: {
          email: '{email}',
          search: '{search}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'accounts.get',
      class: 'read',
      description: 'Read a single account by id.',
      parameters: {
        type: 'object',
        properties: { accountId: { type: 'string' } },
        required: ['accountId'],
      },
      request: { method: 'GET', path: '/api/3/accounts/{accountId}' },
    },
    {
      name: 'accounts.search',
      class: 'read',
      description: 'List or search accounts.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/3/accounts',
        query: {
          search: '{search}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
  ],
})
