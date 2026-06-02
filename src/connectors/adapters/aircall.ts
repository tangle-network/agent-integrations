import { declarativeRestConnector } from './declarative-rest.js'

export const aircallConnector = declarativeRestConnector({
  kind: 'aircall',
  displayName: 'Aircall',
  description: 'Read Aircall calls and contacts and apply lightweight write operations (comments, tags, contact CRUD).',
  auth: { kind: 'api-key', hint: 'Aircall API ID and API token, sent as HTTP Basic credentials.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.aircall.io/v1',
  test: { method: 'GET', path: '/company' },
  capabilities: [
    {
      name: 'calls.find',
      class: 'read',
      description: 'List or search Aircall calls, optionally filtered by direction or phone number.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string' },
          phone_number: { type: 'string' },
          from: { type: 'integer' },
          to: { type: 'integer' },
          per_page: { type: 'integer' },
          page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/calls',
        query: {
          direction: '{direction}',
          phone_number: '{phone_number}',
          from: '{from}',
          to: '{to}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Fetch a single Aircall call by id.',
      parameters: {
        type: 'object',
        properties: { callId: { type: 'string' } },
        required: ['callId'],
      },
      request: { method: 'GET', path: '/calls/{callId}' },
    },
    {
      name: 'calls.comment',
      class: 'mutation',
      description: 'Attach a comment to an Aircall call.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['callId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/calls/{callId}/comments',
        body: { content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.tag',
      class: 'mutation',
      description: 'Apply one or more tags to an Aircall call.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['callId', 'tags'],
      },
      request: {
        method: 'POST',
        path: '/calls/{callId}/tags',
        body: { tags: '{tags}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Search Aircall contacts by phone number or email.',
      parameters: {
        type: 'object',
        properties: {
          phone_number: { type: 'string' },
          email: { type: 'string' },
          per_page: { type: 'integer' },
          page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts/search',
        query: {
          phone_number: '{phone_number}',
          email: '{email}',
          per_page: '{per_page}',
          page: '{page}',
        },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create an Aircall contact with phone numbers and optional metadata.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_name: { type: 'string' },
          information: { type: 'string' },
          phone_numbers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
          emails: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
        },
        required: ['phone_numbers'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          company_name: '{company_name}',
          information: '{information}',
          phone_numbers: '{phone_numbers}',
          emails: '{emails}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing Aircall contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_name: { type: 'string' },
          information: { type: 'string' },
          phone_numbers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
          emails: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
        },
        required: ['contactId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}',
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          company_name: '{company_name}',
          information: '{information}',
          phone_numbers: '{phone_numbers}',
          emails: '{emails}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact from the Aircall directory.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.transfer',
      class: 'mutation',
      description: 'Transfer an active call to another user or number.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
          to: {
            type: 'string',
            description: 'Aircall user id or external E.164 phone number to transfer the call to.',
          },
        },
        required: ['callId', 'to'],
      },
      request: {
        method: 'POST',
        path: '/calls/{callId}/transfers',
        body: { to: '{to}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.archive',
      class: 'mutation',
      description: 'Archive a completed call record.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
        },
        required: ['callId'],
      },
      request: {
        method: 'POST',
        path: '/calls/{callId}/archive',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'numbers.assign',
      class: 'mutation',
      description: 'Assign a phone number to a user or team.',
      parameters: {
        type: 'object',
        properties: {
          numberId: { type: 'string' },
          user_id: { type: 'string', description: 'Aircall user id to assign the number to.' },
          team_id: { type: 'string', description: 'Aircall team id to assign the number to.' },
        },
        required: ['numberId'],
      },
      request: {
        method: 'POST',
        path: '/numbers/{numberId}/users',
        body: {
          user_id: '{user_id}',
          team_id: '{team_id}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
