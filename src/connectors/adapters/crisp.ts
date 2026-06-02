import { declarativeRestConnector } from './declarative-rest.js'

// Crisp exposes a REST API at https://api.crisp.chat/v1.
// Authentication uses HTTP Basic with the API key identifier + key pair
// from the Crisp dashboard (Plugin Settings → API Tokens). The website
// against which actions run is held on the connection metadata as
// websiteId so each capability templates it into the path.
export const crispConnector = declarativeRestConnector({
  kind: 'crisp',
  displayName: 'Crisp',
  description:
    'Manage Crisp customer-support conversations and contacts: create conversations, post operator notes, upsert contact people, find user profiles, and transition conversation state.',
  auth: {
    kind: 'api-key',
    hint: 'Crisp API token identifier + key (HTTP Basic). Connection metadata must include websiteId — the Crisp website ID against which actions run.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.crisp.chat/v1',
  test: { method: 'GET', path: '/website/{websiteId}' },
  capabilities: [
    {
      name: 'conversation.create',
      class: 'mutation',
      description: 'Create a new conversation thread on the connected Crisp website.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
        },
        required: ['websiteId'],
      },
      request: {
        method: 'POST',
        path: '/website/{websiteId}/conversation',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversation.note.add',
      class: 'mutation',
      description:
        'Append an internal operator note to an existing conversation. Notes are visible to operators only.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          sessionId: { type: 'string' },
          content: { type: 'string' },
          from: {
            type: 'string',
            enum: ['operator', 'user'],
            description: 'Who the note is attributed to. Defaults to operator.',
          },
          origin: { type: 'string' },
        },
        required: ['websiteId', 'sessionId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/website/{websiteId}/conversation/{sessionId}/message',
        body: {
          type: 'note',
          content: '{content}',
          from: '{from}',
          origin: '{origin}',
        },
      },
    },
    {
      name: 'contact.upsert',
      class: 'mutation',
      description:
        'Create or update a Crisp People contact identified by email. Sets profile fields (name, phone, company, address, website, notepad).',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          email: { type: 'string' },
          person: {
            type: 'object',
            properties: {
              nickname: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' },
              website: { type: 'string' },
            },
          },
          company: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              url: { type: 'string' },
            },
          },
          notepad: { type: 'string' },
        },
        required: ['websiteId', 'email'],
      },
      request: {
        method: 'POST',
        path: '/website/{websiteId}/people/profile',
        body: {
          email: '{email}',
          person: '{person}',
          company: '{company}',
          notepad: '{notepad}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'user.profile.find',
      class: 'read',
      description: 'Fetch a Crisp People profile by its peopleId (email-hash or contact identifier).',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          peopleId: { type: 'string' },
        },
        required: ['websiteId', 'peopleId'],
      },
      request: {
        method: 'GET',
        path: '/website/{websiteId}/people/profile/{peopleId}',
      },
    },
    {
      name: 'conversation.state.update',
      class: 'mutation',
      description:
        'Transition the state of an existing conversation: pending, unresolved, or resolved.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          sessionId: { type: 'string' },
          state: {
            type: 'string',
            enum: ['pending', 'unresolved', 'resolved'],
          },
        },
        required: ['websiteId', 'sessionId', 'state'],
      },
      request: {
        method: 'PATCH',
        path: '/website/{websiteId}/conversation/{sessionId}/state',
        body: { state: '{state}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'conversation.find',
      class: 'read',
      description:
        'List conversations on the website, optionally filtered by free-text search query and paginated by page number.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          searchQuery: { type: 'string' },
          pageNumber: { type: 'integer' },
        },
        required: ['websiteId'],
      },
      request: {
        method: 'GET',
        path: '/website/{websiteId}/conversations/{pageNumber}',
        query: { search_query: '{searchQuery}' },
      },
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description:
        'Post a user-visible text message into an existing conversation, attributed by default to an operator.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          sessionId: { type: 'string' },
          content: { type: 'string', description: 'Message content (plain text).' },
          from: {
            type: 'string',
            enum: ['operator', 'user'],
            description: 'Who the message is attributed to. Defaults to operator.',
          },
          origin: { type: 'string', description: 'Origin tag for the message (e.g. "chat", "email").' },
        },
        required: ['websiteId', 'sessionId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/website/{websiteId}/conversation/{sessionId}/message',
        body: {
          type: 'text',
          content: '{content}',
          from: '{from}',
          origin: '{origin}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'conversation.assign',
      class: 'mutation',
      description:
        'Assign a conversation to an operator (and optionally pin it to a routing assignment list).',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string' },
          sessionId: { type: 'string' },
          assigned: {
            type: 'object',
            description: 'Routing target. Provide `user_id` to assign to a specific operator.',
            properties: {
              user_id: { type: 'string' },
            },
          },
        },
        required: ['websiteId', 'sessionId', 'assigned'],
      },
      request: {
        method: 'PATCH',
        path: '/website/{websiteId}/conversation/{sessionId}/routing',
        body: { assigned: '{assigned}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
